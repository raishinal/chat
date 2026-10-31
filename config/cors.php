<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => array_filter(explode(',', (string) env('CORS_ALLOWED_ORIGINS', env('APP_URL', 'http://localhost:8000')))),
    'allowed_origins_patterns' => [], 'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'Origin', 'X-Requested-With', 'X-XSRF-TOKEN', 'X-Socket-ID', 'Range'],
    'exposed_headers' => ['Content-Range', 'Content-Length', 'Accept-Ranges', 'Content-Disposition'],
    'max_age' => 600, 'supports_credentials' => true,
];
