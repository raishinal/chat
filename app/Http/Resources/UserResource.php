<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin User */
class UserResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray($request): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'role' => $this->role, 'status' => $this->status, 'last_seen_at' => $this->last_seen_at?->toISOString(), 'online' => $this->last_seen_at?->gt(now()->subSeconds(90)) ?? false, 'avatar_url' => $this->avatar_path ? route('api.avatar', ['user' => $this->id]) : null];
    }
}
