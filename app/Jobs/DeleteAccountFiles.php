<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class DeleteAccountFiles implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @param array<int, array{disk: string, path: string}> $paths */
    public function __construct(public array $paths) {}

    public function handle(): void
    {
        foreach ($this->paths as $file) {
            if (! Storage::disk($file['disk'])->delete($file['path'])) {
                throw new RuntimeException('Account file cleanup failed.');
            }
        }
    }
}
