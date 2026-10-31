<?php

namespace App\Http\Controllers\Api;

use App\Events\ChatEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\ConversationReadRequest;
use App\Http\Requests\Api\ConversationStoreRequest;
use App\Http\Requests\Api\ConversationUsersRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\UserResource;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class ConversationController extends Controller
{
    /** @return AnonymousResourceCollection */
    public function users(ConversationUsersRequest $r)
    {
        $v = $r->validated();

        return UserResource::collection(User::where('status', 'active')->where('id', '!=', $r->user()->id)->when($v['q'] ?? null, fn ($q, $s) => $q->where('name', 'like', '%'.$s.'%'))->orderBy('name')->paginate(20));
    }

    /** @return AnonymousResourceCollection */
    public function index(Request $r)
    {
        return ConversationResource::collection(Conversation::with(['one', 'two'])->where(fn ($q) => $q->where('user_one_id', $r->user()->id)->orWhere('user_two_id', $r->user()->id))->when($r->string('q')->toString(), fn ($q, $s) => $q->where(fn ($q) => $q->whereHas('one', fn ($q) => $q->where('name', 'like', '%'.$s.'%'))->orWhereHas('two', fn ($q) => $q->where('name', 'like', '%'.$s.'%'))))->orderByDesc('updated_at')->paginate(30));
    }

    /** @return ConversationResource */
    public function store(ConversationStoreRequest $r)
    {
        $v = $r->validated();
        $peer = User::whereKey($v['user_id'])->firstOrFail();
        abort_unless($peer->status === 'active' && $peer->id !== $r->user()->id, 422, 'Choose another active user.');
        $ids = [$peer->id, $r->user()->id];
        sort($ids);
        $c = Conversation::firstOrCreate(['user_one_id' => $ids[0], 'user_two_id' => $ids[1]]);
        foreach ($ids as $id) {
            ChatEvent::dispatch('v1.users.'.$id, 'v1.conversation.updated', ['conversation_id' => $c->id]);
        }

        return new ConversationResource($c);
    }

    /** @return ConversationResource */
    public function show(Request $r, Conversation $conversation)
    {
        Gate::authorize('view', $conversation);

        return new ConversationResource($conversation);
    }

    /** @return Response */
    public function read(ConversationReadRequest $r, Conversation $conversation)
    {
        Gate::authorize('view', $conversation);
        $v = $r->validated();
        abort_if($v['message_id'] > 0 && ! $conversation->messages()->whereKey($v['message_id'])->exists(), 422, 'Message does not belong to this conversation.');
        $column = $r->user()->id === $conversation->user_one_id ? 'one_read_id' : 'two_read_id';
        $conversation->whereKey($conversation->id)->where($column, '<', $v['message_id'])->update([$column => $v['message_id']]);
        ChatEvent::dispatch('v1.conversations.'.$conversation->id, 'v1.message.read', ['conversation_id' => $conversation->id, 'user_id' => $r->user()->id, 'message_id' => $v['message_id']]);

        return response()->noContent();
    }

    /** @return Response */
    public function typing(Request $r, Conversation $conversation)
    {
        Gate::authorize('send', $conversation);
        ChatEvent::dispatch('v1.conversations.'.$conversation->id, 'v1.typing', ['conversation_id' => $conversation->id, 'user_id' => $r->user()->id, 'expires_at' => now()->addSeconds(8)->toISOString()]);

        return response()->noContent();
    }
}
