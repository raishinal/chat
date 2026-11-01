<?php

namespace App\Http\Controllers\Api;

use App\Events\SignalEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\CallRequest;
use App\Http\Requests\Api\CallSignalRequest;
use App\Http\Requests\Api\CallUpdateRequest;
use App\Models\Call;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Calls;
use App\Services\CloudflareTurn;
use App\Services\Notifier;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class CallController extends Controller
{
    /** @return CursorPaginator<int, Call> */
    public function index(Request $r, Calls $calls)
    {
        $calls->expire();

        return Call::where(fn ($q) => $q->where('caller_id', $r->user()->id)->orWhere('callee_id', $r->user()->id))->latest('id')->cursorPaginate(30);
    }

    /** @return JsonResponse */
    public function store(CallRequest $r, Conversation $conversation, Calls $calls)
    {
        Gate::authorize('send', $conversation);
        $calls->expire();

        return DB::transaction(function () use ($r, $conversation, $calls) {
            $ids = [$conversation->user_one_id, $conversation->user_two_id];
            sort($ids);
            User::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
            if (DB::table('active_calls')->whereIn('user_id', $ids)->exists()) {
                $busy = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $r->user()->id, 'callee_id' => $conversation->other($r->user()->id)->id, 'kind' => $r->kind, 'status' => 'busy', 'expires_at' => now(), 'ended_at' => now()]);

                return response()->json(['message' => 'One participant is already in a call.', 'call' => $busy], 409);
            }
            $call = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $r->user()->id, 'callee_id' => $conversation->other($r->user()->id)->id, 'kind' => $r->kind, 'status' => 'ringing', 'expires_at' => now()->addSeconds(config('chat.ring_seconds'))]);
            foreach ($ids as $id) {
                DB::table('active_calls')->insert(['user_id' => $id, 'call_id' => $call->id]);
            }
            $calls->publish($call);
            app(Notifier::class)->send($call->callee_id, 'incoming_call', ['call_id' => $call->id, 'conversation_id' => $conversation->id]);

            return response()->json(['data' => $call], 201);
        });
    }

    private function participant(Request $r, Call $call): void
    {
        abort_unless(in_array($r->user()->id, [$call->caller_id, $call->callee_id], true), 404);
    }

    /** @return array{data: Call} */
    public function update(CallUpdateRequest $r, Call $call, Calls $calls)
    {
        $this->participant($r, $call);
        $r->validated();
        $calls->expire();

        return DB::transaction(function () use ($r, $call, $calls) {
            $call = Call::lockForUpdate()->findOrFail($call->id);
            $a = $r->action;
            if ($call->ended_at !== null && in_array($a, ['end', 'cancel', 'reject', 'failed'], true)) {
                return ['data' => $call];
            }
            abort_if($call->ended_at !== null, 409, 'This call has already ended.');
            $caller = $r->user()->id === $call->caller_id;
            $allowed = match ($a) {
                'accept','reject' => ! $caller && $call->status === 'ringing', 'cancel' => $caller && $call->status === 'ringing', 'connected' => in_array($call->status, ['accepted', 'connected']), 'heartbeat' => in_array($call->status, ['accepted', 'connected']), 'end','failed' => true, default => false
            };
            abort_unless($allowed, 409, 'Invalid call transition.');
            if (in_array($a, ['reject', 'cancel', 'end', 'failed'])) {
                $calls->finish($call, match ($a) {
                    'reject' => 'rejected','cancel' => 'cancelled','end' => 'ended', default => 'failed'
                });
            } else {
                $seen = $caller ? 'caller_seen_at' : 'callee_seen_at';
                $call->{$seen} = now();
                if ($a === 'accept') {
                    $call->caller_seen_at = now();
                    $call->callee_seen_at = now();
                }
                $oldest = ($call->caller_seen_at ?? now()->subSeconds(config('chat.call_lease_seconds')))->min($call->callee_seen_at ?? now()->subSeconds(config('chat.call_lease_seconds')));
                $values = ['expires_at' => $oldest->copy()->addSeconds(config('chat.call_lease_seconds'))];
                if ($a === 'accept') {
                    $values['status'] = 'accepted';
                } if ($a === 'connected') {
                    $values['status'] = 'connected';
                    $values['connected_at'] = $call->connected_at ?? now();
                } $call->update($values);
                if ($a !== 'heartbeat') {
                    $calls->publish($call);
                }
            }

            return ['data' => $call];
        });
    }

    /** @return Response */
    public function signal(CallSignalRequest $r, Call $call)
    {
        abort_unless(config('broadcasting.default') === 'pusher', 503, 'Configure Pusher to enable calling.');
        $this->participant($r, $call);
        Gate::authorize('send', $call->conversation);
        $v = $r->validated();
        if ($v['type'] === 'ice' && $v['payload']['candidate'] === null) {
            // Laravel converts empty strings to null; preserve the WebRTC wire format.
            $v['payload']['candidate'] = '';
        }
        abort_unless(in_array($call->status, ['accepted', 'connected']) && $call->expires_at->isFuture(), 409, 'Call cannot accept signaling.');
        abort_if(($v['type'] === 'offer' && $r->user()->id !== $call->caller_id) || ($v['type'] === 'answer' && $r->user()->id !== $call->callee_id), 403);
        // Chunks avoid Pusher's 10KB event limit for larger SDP descriptions.
        $payload = json_encode($v['payload'], JSON_THROW_ON_ERROR);
        $chunks = str_split(base64_encode($payload), 6000);
        $signalId = (string) Str::uuid();
        $peer = $r->user()->id === $call->caller_id ? $call->callee_id : $call->caller_id;
        foreach ($chunks as $index => $chunk) {
            SignalEvent::dispatch('v1.users.'.$peer, 'v1.call.signal', ['call_id' => $call->id, 'type' => $v['type'], 'signal_id' => $signalId, 'index' => $index, 'total' => count($chunks), 'chunk' => $chunk]);
        }

        return response()->noContent();
    }

    public function ice(CloudflareTurn $turn): JsonResponse
    {
        return response()->json($turn->credentials())->withHeaders([
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
        ]);
    }
}
