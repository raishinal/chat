<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

class ChatEvent implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable;

    /** @param array<string, mixed> $payload */
    public function __construct(public string $channel, public string $name, public array $payload) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel($this->channel)];
    }

    public function broadcastAs(): string
    {
        return $this->name;
    }

    public function shouldBroadcastNow(): bool
    {
        // Answering a call must not wait for the database queue's polling cycle.
        return $this->name === 'v1.call.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        if (strlen(json_encode($this->payload, JSON_THROW_ON_ERROR)) > 7500 && $this->name === 'v1.message.created') {
            $this->payload = ['id' => $this->payload['id'], 'conversation_id' => $this->payload['conversation_id']];
        }

        return ['version' => 1, 'event' => $this->name, 'occurred_at' => now()->toISOString(), 'data' => $this->payload];
    }
}
