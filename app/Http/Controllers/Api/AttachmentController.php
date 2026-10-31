<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\UploadRequest;
use App\Http\Resources\AttachmentResource;
use App\Jobs\GenerateThumbnail;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\Response;

class AttachmentController extends Controller
{
    /** @return AnonymousResourceCollection */
    public function store(UploadRequest $r, Conversation $conversation)
    {
        $stored = [];
        try {
            $items = DB::transaction(function () use ($r, $conversation, &$stored) {
                User::whereKey($r->user()->id)->lockForUpdate()->firstOrFail();
                $size = array_sum(array_map(fn ($f) => $f->getSize(), $r->file('files')));
                abort_if(Attachment::where('user_id', $r->user()->id)->sum('size') + $size > config('chat.storage_limit_bytes'), 422, 'Your storage limit has been reached.');
                $items = [];
                foreach ($r->file('files') as $file) {
                    $disk = config('chat.disk');
                    $path = 'attachments/'.Str::uuid();
                    abort_unless(Storage::disk($disk)->putFileAs('attachments', $file, basename($path)) !== false, 503, 'Storage is unavailable.');
                    $stored[] = [$disk, $path];
                    $name = mb_substr(preg_replace('/[\x00-\x1F\x7F\/\\\\]/u', '_', $file->getClientOriginalName()) ?: 'file', 0, 180);
                    $a = Attachment::create(['conversation_id' => $conversation->id, 'user_id' => $r->user()->id, 'disk' => $disk, 'path' => $path, 'name' => $name, 'mime' => $file->getMimeType() ?: 'application/octet-stream', 'size' => $file->getSize()]);
                    GenerateThumbnail::dispatch($a->id);
                    $items[] = $a;
                }

                return $items;
            });
        } catch (\Throwable $e) {
            foreach ($stored as [$disk,$path]) {
                Storage::disk($disk)->delete($path);
            } throw $e;
        }

        return AttachmentResource::collection(collect($items));
    }

    /** @return Response */
    public function show(Request $r, Attachment $attachment)
    {
        Gate::authorize('view', $attachment->conversation);
        $inline = in_array($attachment->mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav']) && ! $r->boolean('download');
        $path = $r->boolean('thumbnail') && $attachment->thumbnail_path ? $attachment->thumbnail_path : $attachment->path;

        return $this->stream($r, $attachment->disk, $path, $attachment->name, $r->boolean('thumbnail') && $attachment->thumbnail_path ? 'image/jpeg' : $attachment->mime, $inline);
    }

    /** @return Response */
    public function stream(Request $r, string $disk, string $path, string $name, string $mime, bool $inline)
    {
        $storage = Storage::disk($disk);
        abort_unless($storage->exists($path), 404);
        $size = $storage->size($path);
        $start = 0;
        $end = $size - 1;
        $status = 200;
        if ($range = $r->header('Range')) {
            if (! preg_match('/^bytes=(\d*)-(\d*)$/', $range, $m) || ($m[1] === '' && $m[2] === '')) {
                return response('', 416, ['Content-Range' => 'bytes */'.$size]);
            }
            if ($m[1] === '') {
                $start = max(0, $size - (int) $m[2]);
            } else {
                $start = (int) $m[1];
                if ($m[2] !== '') {
                    $end = min($end, (int) $m[2]);
                }
            }
            if ($start > $end || $start >= $size) {
                return response('', 416, ['Content-Range' => 'bytes */'.$size]);
            }
            $status = 206;
        }
        $length = max(0, $end - $start + 1);
        $headers = ['Content-Type' => $inline ? $mime : 'application/octet-stream', 'Content-Length' => (string) $length, 'Accept-Ranges' => 'bytes', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => "default-src 'none'; sandbox", 'Content-Disposition' => HeaderUtils::makeDisposition($inline ? 'inline' : 'attachment', $name, 'file')];
        if ($status === 206) {
            $headers['Content-Range'] = "bytes $start-$end/$size";
        }

        return response()->stream(function () use ($storage, $path, $start, $length) {
            $stream = $storage->readStream($path);
            if (! is_resource($stream)) {
                return;
            } try {
                $meta = stream_get_meta_data($stream);
                if ($meta['seekable']) {
                    fseek($stream, $start);
                } else {
                    $skip = $start;
                    while ($skip > 0 && ! feof($stream)) {
                        $chunk = fread($stream, min(65536, $skip));
                        if ($chunk === false || $chunk === '') {
                            break;
                        }
                        $skip -= strlen($chunk);
                    }
                } $left = $length;
                while ($left > 0 && ! feof($stream)) {
                    $chunk = fread($stream, min(65536, $left));
                    if ($chunk === false || $chunk === '') {
                        break;
                    }
                    echo $chunk;
                    $left -= strlen($chunk);
                }
            } finally {
                fclose($stream);
            }
        }, $status, $headers);
    }
}
