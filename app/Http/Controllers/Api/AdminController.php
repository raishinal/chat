<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\AdminUserRequest;
use App\Jobs\TerminateConnections;
use App\Models\Attachment;
use App\Models\User;
use App\Services\Invitations;
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
    public function store(AdminUserRequest $r, Invitations $invitations)
    {
        return DB::transaction(function () use ($r, $invitations) {
            $u = new User($r->safe()->only(['name', 'email']));
            $u->forceFill(['role' => $r->role, 'status' => 'pending', 'password' => Str::random(64)])->save();
            $invitations->send($u);
            $this->audit($r, $u, 'user.invited');

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
            abort_if($user->status === 'pending' && $r->has('status') && $r->status === 'active', 422, 'Pending users must accept an invitation.');
            $emailChanged = $user->email !== $r->email;
            $user->forceFill($r->safe()->only(['name', 'email', 'role', 'status']))->save();
            if ($user->status === 'suspended' || $emailChanged) {
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

    /** @return Response */
    public function invite(Request $r, User $user, Invitations $invitations)
    {
        $this->admin($r);
        $invitations->send($user);
        $this->audit($r, $user, 'invitation.resent');

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
