<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChatNotification;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class NotificationController extends Controller
{
    /** @return CursorPaginator<int, ChatNotification> */
    public function index(Request $r)
    {
        return ChatNotification::where('user_id', $r->user()->id)->latest('id')->cursorPaginate(30);
    }

    /** @return Response */
    public function read(Request $r, ChatNotification $notification)
    {
        abort_unless($notification->user_id === $r->user()->id, 404);
        $notification->update(['read_at' => now()]);

        return response()->noContent();
    }
}
