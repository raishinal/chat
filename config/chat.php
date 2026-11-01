<?php

return [
    'disk' => env('CHAT_DISK', 'local'), 'max_file_kb' => (int) env('CHAT_MAX_FILE_KB', 1048576), 'max_attachments' => (int) env('CHAT_MAX_ATTACHMENTS', 5), 'storage_limit_bytes' => (int) env('CHAT_STORAGE_LIMIT_BYTES', 1073741824),
    'invitation_hours' => (int) env('CHAT_INVITATION_HOURS', 48), 'ring_seconds' => 45, 'call_lease_seconds' => 90,
    'cloudflare_turn' => [
        'key_id' => env('CLOUDFLARE_TURN_KEY_ID'),
        'api_token' => env('CLOUDFLARE_TURN_API_TOKEN'),
        'ttl' => (int) env('CLOUDFLARE_TURN_TTL', 3600),
    ],
];
