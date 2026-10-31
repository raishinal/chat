<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\User;

class ConversationPolicy
{
    public function view(User $user, Conversation $conversation): bool
    {
        return $user->status === 'active' && in_array($user->id, [$conversation->user_one_id, $conversation->user_two_id], true);
    }

    public function send(User $user, Conversation $conversation): bool
    {
        return $this->view($user, $conversation) && $conversation->one->status === 'active' && $conversation->two->status === 'active';
    }
}
