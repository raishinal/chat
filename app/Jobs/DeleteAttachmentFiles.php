<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class DeleteAttachmentFiles implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [5, 30, 120];

    /** @param list<string> $paths */
    public function __construct(public string $disk, public array $paths)
    {
        $this->afterCommit();
    }

    public function handle(): void
    {
        if (! Storage::disk($this->disk)->delete($this->paths)) {
            throw new RuntimeException('Attachment file cleanup failed.');
        }
    }
}
