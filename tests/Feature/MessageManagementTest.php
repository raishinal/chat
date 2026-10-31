<?php

use App\Events\ChatEvent;
use App\Jobs\DeleteAttachmentFiles;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

function managedMessage(): array
{
    $sender = User::factory()->create();
    $recipient = User::factory()->create();
    $conversation = Conversation::create(['user_one_id' => $sender->id, 'user_two_id' => $recipient->id]);
    $message = $conversation->messages()->create(['sender_id' => $sender->id, 'client_id' => (string) Str::uuid(), 'body' => 'Original']);

    return [$sender, $recipient, $conversation, $message];
}

function managedAttachment(User $sender, Conversation $conversation, ?Message $message = null): Attachment
{
    Storage::disk('local')->put('attachments/file', 'file');
    Storage::disk('local')->put('attachments/file.thumb.jpg', 'thumbnail');

    return Attachment::create(['user_id' => $sender->id, 'conversation_id' => $conversation->id, 'message_id' => $message?->id, 'disk' => 'local', 'path' => 'attachments/file', 'thumbnail_path' => 'attachments/file.thumb.jpg', 'name' => 'file.txt', 'mime' => 'text/plain', 'size' => 4]);
}

test('sender edits text without changing identity and broadcasts the change', function () {
    [$sender, $recipient, $conversation, $message] = managedMessage();
    Event::fake([ChatEvent::class]);
    $this->travelTo(now()->startOfSecond());

    $this->actingAs($sender)->patchJson('/api/v1/messages/'.$message->id, ['body' => 'Updated', 'sender_id' => $recipient->id])
        ->assertOk()->assertJsonPath('data.body', 'Updated')->assertJsonPath('data.edited_at', now()->toISOString());

    $this->assertDatabaseHas('messages', ['id' => $message->id, 'body' => 'Updated', 'sender_id' => $sender->id, 'client_id' => $message->client_id]);
    Event::assertDispatched(ChatEvent::class, fn ($event) => $event->name === 'v1.message.updated' && $event->channel === 'v1.conversations.'.$conversation->id && $event->payload['id'] === $message->id);
    $this->actingAs($recipient)->getJson('/api/v1/conversations/'.$conversation->id.'/messages')->assertJsonPath('data.0.body', 'Updated');
});

test('message and attachment mutations require authentication', function () {
    Storage::fake('local');
    [$sender, , $conversation, $message] = managedMessage();
    $attachment = managedAttachment($sender, $conversation, $message);

    $this->patchJson('/api/v1/messages/'.$message->id, ['body' => 'Changed'])->assertUnauthorized();
    $this->deleteJson('/api/v1/messages/'.$message->id)->assertUnauthorized();
    $this->deleteJson('/api/v1/attachments/'.$attachment->id)->assertUnauthorized();
    $this->assertDatabaseHas('messages', ['id' => $message->id, 'body' => 'Original', 'deleted_at' => null]);
    $this->assertModelExists($attachment);
});

test('recipient outsiders and admins cannot modify another senders messages or files', function (string $actor) {
    Storage::fake('local');
    [$sender, $recipient, $conversation, $message] = managedMessage();
    $attachment = managedAttachment($sender, $conversation, $message);
    $user = $actor === 'recipient' ? $recipient : User::factory()->create(['role' => $actor === 'admin' ? 'admin' : 'user']);
    Event::fake([ChatEvent::class]);
    Queue::fake([DeleteAttachmentFiles::class]);

    $this->actingAs($user)->patchJson('/api/v1/messages/'.$message->id, ['body' => 'Changed'])->assertForbidden();
    $this->deleteJson('/api/v1/messages/'.$message->id)->assertForbidden();
    $this->deleteJson('/api/v1/attachments/'.$attachment->id)->assertForbidden();

    $this->assertDatabaseHas('messages', ['id' => $message->id, 'body' => 'Original', 'deleted_at' => null]);
    $this->assertModelExists($attachment);
    Storage::disk('local')->assertExists('attachments/file');
    Event::assertNotDispatched(ChatEvent::class);
    Queue::assertNotPushed(DeleteAttachmentFiles::class);
})->with(['recipient', 'outsider', 'admin']);

test('invalid message edits return 422 and preserve text', function (array $payload) {
    [$sender, , , $message] = managedMessage();

    $this->actingAs($sender)->patchJson('/api/v1/messages/'.$message->id, $payload)->assertUnprocessable();

    $this->assertDatabaseHas('messages', ['id' => $message->id, 'body' => 'Original', 'edited_at' => null]);
})->with(['missing' => [[]], 'empty' => [['body' => '   ']], 'too long' => [['body' => str_repeat('a', 4001)]], 'invalid type' => [['body' => ['text']]]]);

test('deleting a message removes its text and attachments and preserves retry and cursor identity', function () {
    Storage::fake('local');
    [$sender, $recipient, $conversation, $message] = managedMessage();
    $attachment = managedAttachment($sender, $conversation, $message);
    Queue::fake([DeleteAttachmentFiles::class]);
    Event::fake([ChatEvent::class]);

    $this->actingAs($sender)->deleteJson('/api/v1/messages/'.$message->id)->assertOk()
        ->assertJsonPath('data.body', null)->assertJsonCount(0, 'data.attachments');

    expect($message->fresh()->deleted_at)->not->toBeNull();
    $this->assertModelMissing($attachment);
    Queue::assertPushed(DeleteAttachmentFiles::class, function ($job) {
        $job->handle();

        return $job->disk === 'local';
    });
    Storage::disk('local')->assertMissing(['attachments/file', 'attachments/file.thumb.jpg']);
    Event::assertDispatched(ChatEvent::class, fn ($event) => $event->name === 'v1.message.updated');
    $this->deleteJson('/api/v1/messages/'.$message->id)->assertOk();
    $this->patchJson('/api/v1/messages/'.$message->id, ['body' => 'Restore'])->assertConflict();
    $this->postJson('/api/v1/conversations/'.$conversation->id.'/messages', ['client_id' => $message->client_id, 'body' => 'Original'])->assertOk()->assertJsonPath('data.body', null);
    $this->actingAs($recipient)->getJson('/api/v1/conversations/'.$conversation->id)->assertJsonPath('data.unread_count', 0);
    $this->getJson('/api/v1/conversations/'.$conversation->id.'/messages')->assertJsonPath('data.0.body', null)->assertJsonCount(0, 'data.0.attachments');
    $this->getJson('/api/v1/attachments/'.$attachment->id)->assertNotFound();
});

test('sender can delete a file while preserving the rest of the message', function () {
    Storage::fake('local');
    [$sender, , $conversation, $message] = managedMessage();
    $attachment = managedAttachment($sender, $conversation, $message);
    Queue::fake([DeleteAttachmentFiles::class]);
    Event::fake([ChatEvent::class]);

    $this->actingAs($sender)->deleteJson('/api/v1/attachments/'.$attachment->id)->assertNoContent();

    $this->assertModelMissing($attachment);
    $this->assertDatabaseHas('messages', ['id' => $message->id, 'body' => 'Original', 'deleted_at' => null]);
    Event::assertDispatched(ChatEvent::class, fn ($event) => $event->name === 'v1.message.updated');
    Queue::assertPushed(DeleteAttachmentFiles::class, function ($job) {
        $job->handle();

        return true;
    });
    Storage::disk('local')->assertMissing(['attachments/file', 'attachments/file.thumb.jpg']);
});

test('removing the final file from an attachment only message deletes the empty message', function () {
    Storage::fake('local');
    [$sender, , $conversation, $message] = managedMessage();
    managedAttachment($sender, $conversation, $message);
    Queue::fake([DeleteAttachmentFiles::class]);

    $this->actingAs($sender)->patchJson('/api/v1/messages/'.$message->id, ['body' => null])->assertOk()->assertJsonPath('data.body', null);
    $this->deleteJson('/api/v1/attachments/'.$message->attachments()->first()->id)->assertNoContent();

    expect($message->fresh()->deleted_at)->not->toBeNull();
    $this->assertDatabaseCount('attachments', 0);
    Queue::assertPushed(DeleteAttachmentFiles::class);
});

test('sender can delete an upload before sending it', function () {
    Storage::fake('local');
    [$sender, , $conversation] = managedMessage();
    $attachment = managedAttachment($sender, $conversation);
    Queue::fake([DeleteAttachmentFiles::class]);

    $this->actingAs($sender)->deleteJson('/api/v1/attachments/'.$attachment->id)->assertNoContent();

    $this->assertModelMissing($attachment);
    Queue::assertPushed(DeleteAttachmentFiles::class);
});
