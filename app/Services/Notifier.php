<?php

namespace App\Services;

use App\Events\ChatEvent;
use App\Models\ChatNotification;

class Notifier
{
    /** @param array<string, mixed> $data */
    public function send(int $userId, string $kind, array $data): void
    {
        $notice = ChatNotification::create(['user_id' => $userId, 'kind' => $kind, 'data' => $data]);
        ChatEvent::dispatch('v1.users.'.$userId, 'v1.notification.created', $notice->toArray());
    }
}
