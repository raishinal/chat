<?php

namespace App\Http\Resources;

use App\Models\Conversation;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Conversation */
class ConversationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray($request): array
    {
        $me = $request->user()->id;

        return ['id' => $this->id, 'peer' => new UserResource($this->other($me)), 'unread_count' => $this->messages()->where('sender_id', '!=', $me)->where('id', '>', $this->readId($me))->count(), 'read_id' => $this->readId($me), 'peer_read_id' => $this->readId($this->other($me)->id), 'latest_message' => ($m = $this->messages()->with('attachments')->latest('id')->first()) ? new MessageResource($m) : null, 'updated_at' => $this->updated_at->toISOString()];
    }
}
