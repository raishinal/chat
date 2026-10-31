<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Broadcast;

class TerminateConnections implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $userId)
    {
        $this->afterCommit();
    }

    public function handle(): void
    {
        Broadcast::connection('pusher')->getPusher()->terminateUserConnections((string) $this->userId);
    }
}
