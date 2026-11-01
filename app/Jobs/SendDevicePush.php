<?php

namespace App\Jobs;

use App\Models\Call;
use App\Services\NativePush;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class SendDevicePush implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @param array<string, mixed> $data */
    public function __construct(public int $userId, public string $kind, public array $data)
    {
        $this->onQueue('push');
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [2, 5];
    }

    public function handle(NativePush $push): void
    {
        if (isset($this->data['call_id']) && $this->kind === 'call') {
            $call = Call::whereKey($this->data['call_id'])->first();
            if (! $call) {
                return;
            }
            // Read the latest state at delivery time, never ring a cancelled/expired call.
            $this->data = array_merge($call->toArray(), [
                'call_id' => $call->id,
                'uuid' => sprintf('00000000-0000-4000-8000-%012x', $call->id),
                'caller_name' => $call->conversation->other($call->callee_id)->name,
            ]);
            if ($call->caller_id === $this->userId && $call->status === 'ringing') {
                return;
            }
            if (! $call->ended_at && $call->expires_at->isPast()) {
                $this->data['status'] = 'missed';
            }
        }
        $push->send($this->userId, $this->kind, $this->data);
    }
}
