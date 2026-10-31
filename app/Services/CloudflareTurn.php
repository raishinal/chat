<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;

class CloudflareTurn
{
    /** @return array<string, mixed> */
    public function credentials(): array
    {
        $keyId = config('chat.cloudflare_turn.key_id');
        $apiToken = config('chat.cloudflare_turn.api_token');
        abort_unless(is_string($keyId) && $keyId !== '' && is_string($apiToken) && $apiToken !== '', 503, 'Cloudflare TURN is not configured. Contact your administrator.');
        // This application's TTL policy is one minute to one day, never permanent credentials.
        $ttl = max(60, min(86400, (int) config('chat.cloudflare_turn.ttl', 3600)));
        $issuedAt = now();
        try {
            $response = Http::acceptJson()->withToken($apiToken)
                ->connectTimeout(3)->timeout(10)
                ->withOptions(['allow_redirects' => false])
                ->post('https://rtc.live.cloudflare.com/v1/turn/keys/'.rawurlencode($keyId).'/credentials/generate-ice-servers', ['ttl' => $ttl]);
        } catch (ConnectionException) {
            // Never report the provider exception: it may carry sensitive request details.
            abort(503, 'Call connectivity is temporarily unavailable. Please retry.');
        }
        abort_unless($response->successful(), 503, 'Call connectivity is temporarily unavailable. Please retry.');
        $servers = $response->json('iceServers');
        $validation = Validator::make(['servers' => $servers], [
            'servers' => ['required', 'array', 'min:1', 'max:10'],
            'servers.*' => ['required', 'array'],
            'servers.*.urls' => ['required', 'array', 'min:1', 'max:20'],
            'servers.*.urls.*' => ['required', 'string', 'regex:/^(stun|stuns|turn|turns):[^\s]+$/'],
            'servers.*.username' => ['sometimes', 'required', 'string'],
            'servers.*.credential' => ['sometimes', 'required', 'string'],
        ]);
        abort_if($validation->fails(), 503, 'Call connectivity returned an invalid configuration. Please retry.');
        $safeServers = [];
        $hasTurn = false;
        foreach ($validation->validated()['servers'] as $server) {
            // Whitelist output instead of relaying arbitrary provider fields to clients.
            $safe = ['urls' => $server['urls']];
            foreach ($server['urls'] as $url) {
                if (str_starts_with($url, 'turn:') || str_starts_with($url, 'turns:')) {
                    abort_unless(isset($server['username'], $server['credential']), 503, 'Call connectivity returned an invalid configuration. Please retry.');
                    $hasTurn = true;
                }
            }
            if (isset($server['username'], $server['credential'])) {
                $safe['username'] = $server['username'];
                $safe['credential'] = $server['credential'];
            }
            $safeServers[] = $safe;
        }
        abort_unless($hasTurn, 503, 'Call connectivity returned an invalid configuration. Please retry.');

        return ['ice_servers' => $safeServers, 'expires_in' => $ttl, 'expires_at' => $issuedAt->addSeconds($ttl)->toISOString()];
    }
}
