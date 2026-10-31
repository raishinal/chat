<?php

namespace App\Http\Resources;

use App\Models\Attachment;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Attachment */
class AttachmentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray($request): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'mime' => $this->mime, 'size' => $this->size, 'previewable' => in_array($this->mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav']), 'url' => route('api.attachments.show', $this->id), 'download_url' => route('api.attachments.show', [$this->id, 'download' => 1]), 'thumbnail_url' => $this->thumbnail_path ? route('api.attachments.show', [$this->id, 'thumbnail' => 1]) : null];
    }
}
