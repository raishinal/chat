<?php

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('v1.users.{id}', fn (User $u, $id) => $u->status === 'active' && $u->id === (int) $id);
Broadcast::channel('v1.conversations.{id}', fn (User $u, $id) => $u->status === 'active' && ($c = Conversation::find($id)) && $u->can('view', $c));
Broadcast::channel('v1.presence', fn (User $u) => $u->status === 'active' ? ['id' => $u->id, 'name' => $u->name] : false);
