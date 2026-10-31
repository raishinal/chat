<?php

namespace App\Events;

use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class SignalEvent extends ChatEvent implements ShouldBroadcastNow {}
