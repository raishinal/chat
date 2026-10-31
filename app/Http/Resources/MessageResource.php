<?php

namespace App\Http\Resources;

use App\Models\Message;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Message */
class MessageResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray($request): array
    {
        return ['id' => $this->id, 'conversation_id' => $this->conversation_id, 'sender_id' => $this->sender_id, 'client_id' => $this->client_id, 'body' => $this->body, 'created_at' => $this->created_at->toISOString(), 'attachments' => AttachmentResource::collection($this->attachments)];
    }
}
