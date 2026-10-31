<?php

namespace App\Http\Controllers;

use App\Http\Requests\Api\InvitationAcceptRequest;
use App\Models\Invitation;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class InvitationController extends Controller
{
    /** @return Response */
    public function show(Request $r, Invitation $invitation)
    {
        $this->valid($invitation, (string) $r->query('token'));

        return Inertia::render('auth/invitation', ['invitation' => $invitation->id, 'token' => $r->query('token'), 'email' => $invitation->user->email]);
    }

    private function valid(Invitation $i, string $token): void
    {
        abort_unless(! $i->used_at && $i->expires_at->isFuture() && $i->user->status === 'pending' && hash_equals($i->token_hash, hash('sha256', $token)), 410, 'This invitation has expired or has already been used.');
    }

    /** @return array<string, string>|RedirectResponse */
    public function accept(InvitationAcceptRequest $r, Invitation $invitation)
    {
        $v = $r->validated();
        DB::transaction(function () use ($invitation, $v) {
            $i = Invitation::lockForUpdate()->findOrFail($invitation->id);
            $this->valid($i, $v['token']);
            $i->user->forceFill(['password' => $v['password'], 'status' => 'active', 'email_verified_at' => now()])->save();
            $i->update(['used_at' => now()]);
        });
        if ($r->expectsJson()) {
            return ['message' => 'Account activated. You can now log in.'];
        }

        return to_route('login')->with('status', 'Account activated. You can now log in.');
    }
}
