<?php

namespace App\Services;

use App\Models\Invitation;
use App\Models\User;
use App\Notifications\AccountInvitation;
use Illuminate\Support\Str;

class Invitations
{
    public function send(User $user): void
    {
        abort_unless($user->status === 'pending', 422, 'Only pending accounts can be invited.');
        $token = Str::random(64);
        $invitation = Invitation::updateOrCreate(['user_id' => $user->id], ['token_hash' => hash('sha256', $token), 'expires_at' => now()->addHours(config('chat.invitation_hours')), 'used_at' => null]);
        $user->notify(new AccountInvitation(route('invitation.show', ['invitation' => $invitation->id, 'token' => $token])));
    }
}
