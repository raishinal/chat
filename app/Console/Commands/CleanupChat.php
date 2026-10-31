<?php

namespace App\Console\Commands;

use App\Models\Attachment;
use App\Services\Calls;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class CleanupChat extends Command
{
    protected $signature = 'chat:cleanup';

    protected $description = 'Expire stale calls and delete abandoned or orphaned uploads';

    public function handle(Calls $calls): int
    {
        $calls->expire();
        Attachment::whereNull('message_id')->where('created_at', '<', now()->subDay())->eachById(function ($a) {
            Storage::disk($a->disk)->delete(array_filter([$a->path, $a->thumbnail_path]));
            $a->delete();
        });
        $disk = Storage::disk(config('chat.disk'));
        foreach ($disk->allFiles('attachments') as $path) {
            if ($disk->lastModified($path) < now()->subDay()->timestamp && ! Attachment::where('path', $path)->orWhere('thumbnail_path', $path)->exists()) {
                $disk->delete($path);
            }
        } $this->info('Chat maintenance complete.');

        return self::SUCCESS;
    }
}
