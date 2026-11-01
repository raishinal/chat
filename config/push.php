<?php

return [
    'firebase_credentials' => env('FIREBASE_CREDENTIALS'),
    'apns_key_path' => env('APNS_KEY_PATH'),
    'apns_key_id' => env('APNS_KEY_ID'),
    'apns_team_id' => env('APNS_TEAM_ID'),
    'apns_topic' => env('APNS_TOPIC', 'com.relay.privatechat'),
    'apns_sandbox' => env('APNS_SANDBOX', true),
];
