<?php

namespace App\Http\Controllers\Api;

use App\Events\ChatEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\AdminUserRequest;
use App\Jobs\DeleteAccountFiles;
use App\Jobs\TerminateConnections;
use App\Models\Attachment;
use App\Models\Call;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Calls;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    private function admin(Request $r): void
    {
        abort_unless($r->user()->role === 'admin', 403);
    }

    private function audit(Request $r, User $u, string $action): void
    {
        DB::table('audit_logs')->insert(['actor_id' => $r->user()->id, 'subject_id' => $u->id, 'action' => $action, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** @return array<string, mixed> */
    public function index(Request $r)
    {
        $this->admin($r);

        return ['metrics' => ['total' => User::count(), 'active' => User::where('status', 'active')->count(), 'pending' => User::where('status', 'pending')->count(), 'suspended' => User::where('status', 'suspended')->count(), 'storage_bytes' => (int) Attachment::sum('size')], 'users' => User::when($r->q, fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', '%'.$s.'%')->orWhere('email', 'like', '%'.$s.'%')))->orderBy('name')->paginate(20)];
    }

    /** @return JsonResponse */
    public function store(AdminUserRequest $r)
    {
        return DB::transaction(function () use ($r) {
            $u = new User($r->safe()->only(['name', 'email', 'password']));
            $u->forceFill(['role' => $r->role, 'status' => $r->input('status', 'active'), 'email_verified_at' => now()])->save();
            $this->audit($r, $u, 'user.created');

            return response()->json(['data' => $u], 201);
        });
    }

    /** @return array<string, mixed> */
    public function update(AdminUserRequest $r, User $user)
    {
        return DB::transaction(function () use ($r, $user) {
            // Serialize all admin mutations on the same admin rows to protect the last-admin invariant.
            User::where('role', 'admin')->orderBy('id')->lockForUpdate()->get();
            $user->refresh();
            abort_if($user->id === $r->user()->id && $r->input('status') === 'suspended', 422, 'You cannot suspend yourself.');
            if ($user->role === 'admin' && $user->status === 'active' && ($r->role !== 'admin' || $r->input('status', $user->status) !== 'active')) {
                abort_if(User::where('role', 'admin')->where('status', 'active')->count() <= 1, 422, 'The last active admin must be retained.');
            }
            abort_if($user->status === 'pending' && $r->input('status') === 'active' && ! $r->filled('password'), 422, 'Set a password to activate this account.');
            $emailChanged = $user->email !== $r->email;
            $oldEmail = $user->email;
            $user->forceFill($r->safe()->only(['name', 'email', 'role', 'status']))->save();
            if ($r->filled('password')) {
                $user->forceFill(['password' => $r->validated('password'), 'remember_token' => Str::random(60), 'email_verified_at' => now()])->save();
                DB::table('password_reset_tokens')->where('email', $user->email)->delete();
                DB::table('invitations')->where('user_id', $user->id)->delete();
                $this->audit($r, $user, 'user.password_changed');
            }
            if ($user->status === 'suspended' || $emailChanged || $r->filled('password')) {
                DB::table('password_reset_tokens')->whereIn('email', [$oldEmail, $user->email])->delete();
                $user->tokens()->delete();
                DB::table('sessions')->where('user_id', $user->id)->delete();
                if (config('broadcasting.default') === 'pusher') {
                    TerminateConnections::dispatch($user->id);
                }
            }
            $this->audit($r, $user, 'user.updated');

            return ['data' => $user];
        });
    }

    public function destroy(Request $r, User $user): Response
    {
        $this->admin($r);
        $r->validate(['confirmation' => ['required', 'string']]);
        DB::transaction(function () use ($r, $user): void {
            User::where('role', 'admin')->orderBy('id')->lockForUpdate()->get();
            $user = User::lockForUpdate()->findOrFail($user->id);
            abort_unless($r->input('confirmation') === $user->email, 422, 'Type the account email to confirm permanent deletion.');
            abort_if($user->id === $r->user()->id, 422, 'You cannot delete your own account.');
            abort_if($user->role === 'admin' && $user->status === 'active' && User::where('role', 'admin')->where('status', 'active')->count() <= 1, 422, 'The last active admin must be retained.');
            $conversations = Conversation::where('user_one_id', $user->id)->orWhere('user_two_id', $user->id)->lockForUpdate()->get();
            $ids = $conversations->modelKeys();
            $paths = [];
            foreach (Attachment::whereIn('conversation_id', $ids)->get() as $attachment) {
                $paths[] = ['disk' => $attachment->disk, 'path' => $attachment->path];
                if ($attachment->thumbnail_path) {
                    $paths[] = ['disk' => $attachment->disk, 'path' => $attachment->thumbnail_path];
                }
            }
            if ($user->avatar_path) {
                $paths[] = ['disk' => 'local', 'path' => $user->avatar_path];
            }
            foreach (Call::whereIn('conversation_id', $ids)->whereNull('ended_at')->lockForUpdate()->get() as $call) {
                app(Calls::class)->finish($call, 'ended');
            }
            foreach ($conversations as $conversation) {
                $peer = $conversation->user_one_id === $user->id ? $conversation->user_two_id : $conversation->user_one_id;
                ChatEvent::dispatch('v1.users.'.$peer, 'v1.conversation.deleted', ['conversation_id' => $conversation->id]);
                DB::table('chat_notifications')->where('user_id', $peer)->where('data->conversation_id', $conversation->id)->delete();
            }
            Conversation::whereIn('id', $ids)->delete();
            $user->tokens()->delete();
            DB::table('sessions')->where('user_id', $user->id)->delete();
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
            $this->audit($r, $user, 'user.deleted');
            $user->delete();
            DeleteAccountFiles::dispatch($paths)->afterCommit();
            if (config('broadcasting.default') === 'pusher') {
                TerminateConnections::dispatch($user->id)->afterCommit();
            }
        });

        return response()->noContent();
    }

    /** @return Response */
    public function reset(Request $r, User $user)
    {
        $this->admin($r);
        abort_unless($user->status === 'active', 422);
        Password::sendResetLink(['email' => $user->email]);
        $this->audit($r, $user, 'password.reset_requested');

        return response()->noContent();
    }

    /** @return LengthAwarePaginator<int, \stdClass> */
    public function auditLog(Request $r)
    {
        $this->admin($r);

        return DB::table('audit_logs')->orderByDesc('id')->paginate(30);
    }
}
