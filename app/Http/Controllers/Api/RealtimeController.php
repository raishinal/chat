<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\RealtimeUserRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Broadcast;

class RealtimeController extends Controller
{
    public function auth(Request $r): JsonResponse
    {
        abort_unless(config('broadcasting.default') === 'pusher', 503, 'The running Laravel server has not enabled Pusher. Restart the Laravel server and queue worker after updating BROADCAST_CONNECTION=pusher.');

        return response()->json(Broadcast::auth($r));
    }

    /** @return Response */
    public function user(RealtimeUserRequest $r)
    {
        $r->validated();

        return response(Broadcast::connection('pusher')->getPusher()->authenticateUser($r->socket_id, ['id' => (string) $r->user()->id]), 200, ['Content-Type' => 'application/json']);
    }
}
