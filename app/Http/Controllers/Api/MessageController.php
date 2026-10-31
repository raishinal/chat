<?php

namespace App\Http\Controllers\Api;

use App\Events\ChatEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\MessageRequest;
use App\Http\Requests\Api\MessageUpdateRequest;
use App\Http\Resources\MessageResource;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Services\MessageChanges;
use App\Services\Notifier;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class MessageController extends Controller
{
    public function update(MessageUpdateRequest $r, Message $message, MessageChanges $changes): MessageResource
    {
        DB::transaction(function () use ($r, &$message, $changes) {
            User::whereKey($r->user()->id)->lockForUpdate()->firstOrFail();
            $message = Message::whereKey($message->id)->lockForUpdate()->firstOrFail();
            abort_if($message->deleted_at !== null, 409, 'Deleted messages cannot be edited.');
            $body = $r->validated('body');
            abort_if(blank($body) && ! $message->attachments()->exists(), 422, 'A message must contain text or an attachment.');
            if ($message->body !== $body) {
                $message->update(['body' => $body, 'edited_at' => now()]);
                $changes->broadcast($message);
            }
        });

        return new MessageResource($message->load('attachments'));
    }

    public function destroy(Request $r, Message $message, MessageChanges $changes): MessageResource
    {
        Gate::authorize('view', $message->conversation);
        abort_unless($message->sender_id === $r->user()->id, 403);
        DB::transaction(function () use ($r, &$message, $changes) {
            User::whereKey($r->user()->id)->lockForUpdate()->firstOrFail();
            $message = Message::whereKey($message->id)->lockForUpdate()->firstOrFail();
            if ($message->deleted_at) {
                return;
            }
            foreach ($message->attachments()->lockForUpdate()->get() as $attachment) {
                $changes->removeAttachment($attachment);
            }
            $message->update(['body' => null, 'deleted_at' => now()]);
            $changes->broadcast($message);
        });

        return new MessageResource($message->load('attachments'));
    }

    /** @return AnonymousResourceCollection */
    public function index(Request $r, Conversation $conversation)
    {
        Gate::authorize('view', $conversation);
        $r->validate(['after_id' => 'nullable|integer|min:0']);

        return MessageResource::collection($conversation->messages()->with('attachments')->when($r->integer('after_id'), fn ($q, $id) => $q->where('id', '>', $id))->orderBy('id', $r->integer('after_id') ? 'asc' : 'desc')->cursorPaginate(40)->withQueryString());
    }

    /** @return MessageResource */
    public function store(MessageRequest $r, Conversation $conversation)
    {
        $message = DB::transaction(function () use ($r, $conversation) {
            User::whereKey($r->user()->id)->lockForUpdate()->firstOrFail();
            if ($existing = Message::where('sender_id', $r->user()->id)->where('client_id', $r->client_id)->first()) {
                abort_unless($existing->conversation_id === $conversation->id, 409, 'Client ID already used in another conversation.');

                return $existing;
            }
            $ids = $r->validated('attachment_ids', []) ?? [];
            $uploads = Attachment::whereIn('id', $ids)->where('conversation_id', $conversation->id)->where('user_id', $r->user()->id)->whereNull('message_id')->lockForUpdate()->get();
            abort_unless($uploads->count() === count($ids), 422, 'One or more attachments are unavailable.');
            $m = $conversation->messages()->create(['sender_id' => $r->user()->id, 'client_id' => $r->client_id, 'body' => $r->validated('body')]);
            Attachment::whereIn('id', $ids)->update(['message_id' => $m->id]);
            $conversation->touch();
            // The user event carries only identifiers; clients fetch the canonical resource.
            foreach ([$conversation->user_one_id, $conversation->user_two_id] as $id) {
                ChatEvent::dispatch('v1.users.'.$id, 'v1.conversation.updated', ['conversation_id' => $conversation->id]);
            }
            app(Notifier::class)->send($conversation->other($r->user()->id)->id, 'message', ['conversation_id' => $conversation->id, 'message_id' => $m->id, 'sender_name' => $r->user()->name]);

            return $m;
        });
        $message->load('attachments');
        if ($message->wasRecentlyCreated) {
            $payload = (new MessageResource($message))->resolve($r);
            ChatEvent::dispatch('v1.conversations.'.$conversation->id, 'v1.message.created', $payload);
        }

        return new MessageResource($message);
    }
}
