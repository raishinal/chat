<?php

namespace App\Jobs;

use App\Models\Attachment;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

class GenerateThumbnail implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function __construct(public int $attachmentId)
    {
        $this->afterCommit();
    }

    public function handle(): void
    {
        $a = Attachment::find($this->attachmentId);
        if (! $a || ! in_array($a->mime, ['image/jpeg', 'image/png', 'image/webp']) || ! function_exists('imagecreatefromstring')) {
            return;
        }
        $disk = Storage::disk($a->disk);
        $bytes = $disk->get($a->path);
        $info = @getimagesizefromstring($bytes);
        if (! $info || $info[0] * $info[1] > 16000000) {
            return;
        }
        $image = @imagecreatefromstring($bytes);
        if (! $image) {
            return;
        }
        try {
            $width = min(480, imagesx($image));
            $thumb = imagescale($image, $width);
            if (! $thumb) {
                return;
            }
            ob_start();
            imagejpeg($thumb, null, 80);
            $data = ob_get_clean();
            $path = $a->path.'.thumb.jpg';
            $disk->put($path, $data);
            $a->update(['thumbnail_path' => $path]);
            imagedestroy($thumb);
        } finally {
            imagedestroy($image);
        }
    }
}
