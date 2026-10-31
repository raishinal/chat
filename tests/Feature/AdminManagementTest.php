<?php

use App\Events\ChatEvent;
use App\Jobs\DeleteAccountFiles;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

test('direct creation rejects missing weak and unconfirmed passwords', function (array $password) {
    $admin = User::factory()->create(['role' => 'admin']);
    $this->actingAs($admin)->postJson('/api/v1/admin/users', array_merge(['name' => 'Member', 'email' => 'new@example.test', 'role' => 'user'], $password))->assertUnprocessable()->assertJsonValidationErrors('password');
    $this->assertDatabaseMissing('users', ['email' => 'new@example.test']);
})->with([
    [[]],
    [['password' => 'short77', 'password_confirmation' => 'short77']],
    [['password' => 'long-safe-password', 'password_confirmation' => 'different-password']],
]);

test('admin password edits revoke target credentials without changing the admin or another account', function () {
    config(['broadcasting.default' => 'log']);
    $admin = User::factory()->create(['role' => 'admin']);
    $target = User::factory()->create(['password' => 'original-password']);
    $token = $target->createToken('phone')->accessToken;
    $adminToken = $admin->createToken('admin')->accessToken;
    DB::table('sessions')->insert(['id' => 'target-session', 'user_id' => $target->id, 'payload' => '', 'last_activity' => time()]);

    $this->actingAs($admin)->patchJson('/api/v1/admin/users/'.$target->id, ['name' => $target->name, 'email' => $target->email, 'role' => 'user', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password'])->assertOk()->assertJsonMissingPath('data.password');

    expect(Hash::check('replacement-password', $target->fresh()->password))->toBeTrue();
    $this->assertDatabaseMissing('personal_access_tokens', ['id' => $token->id]);
    $this->assertDatabaseMissing('sessions', ['id' => 'target-session']);
    $this->assertDatabaseHas('personal_access_tokens', ['id' => $adminToken->id]);
    $this->assertDatabaseHas('audit_logs', ['subject_id' => $target->id, 'action' => 'user.password_changed']);
});

test('leaving the optional password blank preserves the existing password and sessions', function () {
    $admin = User::factory()->create(['role' => 'admin']);
    $target = User::factory()->create(['password' => 'original-password']);
    $token = $target->createToken('phone')->accessToken;
    $this->actingAs($admin)->patchJson('/api/v1/admin/users/'.$target->id, ['name' => 'Updated name', 'email' => $target->email, 'role' => 'user', 'password' => ''])->assertOk();
    expect(Hash::check('original-password', $target->fresh()->password))->toBeTrue();
    $this->assertDatabaseHas('personal_access_tokens', ['id' => $token->id]);
});

test('permanent deletion requires admin access exact confirmation and forbids self deletion', function () {
    $admin = User::factory()->create(['role' => 'admin']);
    $target = User::factory()->create();
    $url = '/api/v1/admin/users/'.$target->id;
    $this->deleteJson($url, ['confirmation' => $target->email])->assertUnauthorized();
    $this->actingAs($target)->deleteJson($url, ['confirmation' => $target->email])->assertForbidden();
    $this->actingAs($admin)->deleteJson($url, ['confirmation' => 'wrong@example.test'])->assertUnprocessable();
    $this->deleteJson('/api/v1/admin/users/'.$admin->id, ['confirmation' => $admin->email])->assertUnprocessable();
    $this->assertDatabaseHas('users', ['id' => $target->id]);
    $this->assertDatabaseHas('users', ['id' => $admin->id]);
});

test('permanent deletion removes shared history and credentials and queues file cleanup after commit', function () {
    config(['broadcasting.default' => 'log']);
    Queue::fake([DeleteAccountFiles::class]);
    Event::fake([ChatEvent::class]);
    Storage::fake('local');
    $admin = User::factory()->create(['role' => 'admin']);
    $target = User::factory()->create(['avatar_path' => 'avatars/deleted.png']);
    $peer = User::factory()->create();
    $conversation = Conversation::create(['user_one_id' => $target->id, 'user_two_id' => $peer->id]);
    $message = $conversation->messages()->create(['sender_id' => $peer->id, 'client_id' => (string) Str::uuid(), 'body' => 'Shared history']);
    $attachment = Attachment::create(['conversation_id' => $conversation->id, 'message_id' => $message->id, 'user_id' => $peer->id, 'disk' => 'local', 'path' => 'attachments/deleted.png', 'thumbnail_path' => 'attachments/thumb.png', 'name' => 'file.png', 'mime' => 'image/png', 'size' => 4]);
    foreach (['avatars/deleted.png', 'attachments/deleted.png', 'attachments/thumb.png', 'attachments/keep.png'] as $path) {
        Storage::disk('local')->put($path, 'data');
    }
    $target->createToken('phone');
    DB::table('sessions')->insert(['id' => 'deleted-session', 'user_id' => $target->id, 'payload' => '', 'last_activity' => time()]);

    $this->actingAs($admin)->deleteJson('/api/v1/admin/users/'.$target->id, ['confirmation' => $target->email])->assertNoContent();

    $this->assertDatabaseMissing('users', ['id' => $target->id]);
    $this->assertDatabaseMissing('conversations', ['id' => $conversation->id]);
    $this->assertDatabaseMissing('messages', ['id' => $message->id]);
    $this->assertDatabaseMissing('attachments', ['id' => $attachment->id]);
    $this->assertDatabaseMissing('sessions', ['id' => 'deleted-session']);
    $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_id' => $target->id]);
    $this->assertDatabaseHas('users', ['id' => $peer->id]);
    Queue::assertPushed(DeleteAccountFiles::class, function (DeleteAccountFiles $job) {
        expect($job->afterCommit)->toBeTrue();
        $job->handle();
        return true;
    });
    Storage::disk('local')->assertMissing(['avatars/deleted.png', 'attachments/deleted.png', 'attachments/thumb.png']);
    Storage::disk('local')->assertExists('attachments/keep.png');
    Event::assertDispatched(ChatEvent::class, fn (ChatEvent $event) => $event->name === 'v1.conversation.deleted' && $event->channel === 'v1.users.'.$peer->id);
});


test('direct creation accepts an eight character password', function () {
    $admin = User::factory()->create(['role' => 'admin']);
    $this->actingAs($admin)->postJson('/api/v1/admin/users', ['name' => 'Member', 'email' => 'eight@example.test', 'role' => 'user', 'password' => 'testpass', 'password_confirmation' => 'testpass'])->assertCreated();
    expect(Hash::check('testpass', User::where('email', 'eight@example.test')->firstOrFail()->password))->toBeTrue();
});
