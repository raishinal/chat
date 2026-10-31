<?php

namespace App\Services;

use App\Events\ChatEvent;
use App\Models\Call;
use Illuminate\Support\Facades\DB;

class Calls
{
    public function publish(Call $call): void
    {
        foreach ([$call->caller_id, $call->callee_id] as $id) {
            ChatEvent::dispatch('v1.users.'.$id, 'v1.call.updated', $call->toArray());
        }
    }

    public function finish(Call $call, string $status): void
    {
        $call->update(['status' => $status, 'ended_at' => now()]);
        DB::table('active_calls')->where('call_id', $call->id)->delete();
        $this->publish($call);
        if (in_array($status, ['missed', 'timeout'])) {
            app(Notifier::class)->send($call->callee_id, 'missed_call', ['call_id' => $call->id, 'conversation_id' => $call->conversation_id]);
        }
    }

    public function expire(): void
    {
        Call::whereNull('ended_at')->where('expires_at', '<=', now())->pluck('id')->each(function (int $id) {
            DB::transaction(function () use ($id) {
                $call = Call::lockForUpdate()->find($id);
                if ($call && ! $call->ended_at && $call->expires_at->isPast()) {
                    $this->finish($call, $call->status === 'ringing' ? 'missed' : 'timeout');
                }
            });
        });
    }
}
