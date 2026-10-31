<?php

namespace App\Services;

use App\Events\ChatEvent;
use App\Jobs\DeleteAttachmentFiles;
use App\Models\Attachment;
use App\Models\Message;

class MessageChanges
{
    public function removeAttachment(Attachment $attachment): void
    {
        $paths = array_values(array_unique(array_filter([$attachment->path, $attachment->thumbnail_path, $attachment->path.'.thumb.jpg'])));
        $attachment->delete();
        DeleteAttachmentFiles::dispatch($attachment->disk, $paths);
    }

    public function broadcast(Message $message): void
    {
        ChatEvent::dispatch('v1.conversations.'.$message->conversation_id, 'v1.message.updated', ['id' => $message->id, 'conversation_id' => $message->conversation_id]);
        $conversation = $message->conversation;
        foreach ([$conversation->user_one_id, $conversation->user_two_id] as $id) {
            ChatEvent::dispatch('v1.users.'.$id, 'v1.conversation.updated', ['conversation_id' => $conversation->id]);
        }
    }
}
