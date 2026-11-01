<?php

namespace App\Services;

use App\Models\Device;
use Firebase\JWT\JWT;
use Google\Auth\Credentials\ServiceAccountCredentials;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class NativePush
{
    private function readKey(string $path): string
    {
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException('Push credentials are unreadable.');
        }

        return $contents;
    }

    /** @param array<string, mixed> $data */
    public function send(int $userId, string $kind, array $data): void
    {
        // Devices are bound to an unexpired login, so revocation stops delivery too.
        $devices = Device::query()->join('personal_access_tokens as tokens', 'tokens.id', '=', 'devices.personal_access_token_id')
            ->join('users', 'users.id', '=', 'devices.user_id')
            ->where('devices.user_id', $userId)->where('users.status', 'active')
            ->where(fn ($q) => $q->whereNull('tokens.expires_at')->orWhere('tokens.expires_at', '>', now()))
            ->select('devices.*')->get();
        $failed = false;
        foreach ($devices as $device) {
            try {
                $delivery = 'push.delivered.'.hash('sha256', json_encode([$device->id, $kind, $data], JSON_THROW_ON_ERROR));
                if (Cache::has($delivery)) {
                    continue;
                }
                $ringing = $kind === 'call' && ($data['status'] ?? '') === 'ringing' && empty($data['ended_at']);
                $sent = false;
                if ($device->platform === 'ios' && $ringing && $device->voip_token && config('push.apns_key_path')) {
                    $this->voip($device, $data);
                    $sent = true;
                } elseif ($device->push_token && config('push.firebase_credentials')) {
                    $this->fcm($device, $kind, $data);
                    $sent = true;
                }
                if ($sent) {
                    Cache::put($delivery, true, 86400);
                }
            } catch (\Throwable) {
                // Exceptions from HTTP clients may contain device tokens or private keys.
                $failed = true;
            }
        }
        if ($failed) {
            throw new RuntimeException('Push delivery failed; retrying without logging credentials.');
        }
    }

    /** @param array<string, mixed> $data */
    private function fcm(Device $device, string $kind, array $data): void
    {
        $path = config('push.firebase_credentials');
        $credentials = json_decode($this->readKey($path), true, flags: JSON_THROW_ON_ERROR);
        $token = Cache::remember('push.fcm.'.hash('sha256', $path), 3000, function () use ($credentials) {
            $auth = new ServiceAccountCredentials('https://www.googleapis.com/auth/firebase.messaging', $credentials);

            return $auth->fetchAuthToken()['access_token'];
        });
        $payload = ['type' => $kind];
        foreach ($data as $key => $value) {
            $payload[$key] = is_scalar($value) ? (string) $value : json_encode($value);
        }
        $message = ['token' => $device->push_token, 'data' => $payload, 'android' => ['priority' => 'high', 'ttl' => $kind === 'call' ? '30s' : '86400s']];
        if ($kind !== 'call') {
            $message['notification'] = ['title' => $data['sender_name'] ?? 'Relay', 'body' => $kind === 'missed_call' ? 'Missed call' : 'New message'];
            $message['android']['notification'] = ['channel_id' => 'relay-messages', 'sound' => 'message'];
            $message['apns'] = ['payload' => ['aps' => ['sound' => 'message.wav']]];
        } else {
            // iOS state changes use background APNs; VoIP is reserved for new calls.
            $message['apns'] = ['headers' => ['apns-push-type' => 'background', 'apns-priority' => '5'], 'payload' => ['aps' => ['content-available' => 1]]];
            $message['android']['collapse_key'] = 'call-'.$data['call_id'];
        }
        $response = Http::withToken($token)->connectTimeout(3)->timeout(10)
            ->post('https://fcm.googleapis.com/v1/projects/'.rawurlencode($credentials['project_id']).'/messages:send', ['message' => $message]);
        if ($response->json('error.details.0.errorCode') === 'UNREGISTERED') {
            DB::table('devices')->where('id', $device->id)->where('push_token', $device->getRawOriginal('push_token'))->update(['push_token' => null]);

            return;
        }
        $response->throw();
    }

    /** @param array<string, mixed> $data */
    private function voip(Device $device, array $data): void
    {
        $jwt = Cache::remember('push.apns.'.config('push.apns_key_id'), 3000, fn () => JWT::encode(
            ['iss' => config('push.apns_team_id'), 'iat' => time()],
            $this->readKey(config('push.apns_key_path')), 'ES256', config('push.apns_key_id'),
        ));
        $host = config('push.apns_sandbox') ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
        $response = Http::withOptions(['version' => '2.0'])->withToken($jwt)->withHeaders([
            'apns-topic' => config('push.apns_topic').'.voip', 'apns-push-type' => 'voip', 'apns-priority' => '10',
            'apns-expiration' => (string) strtotime($data['expires_at']),
        ])->connectTimeout(3)->timeout(10)->post($host.'/3/device/'.$device->voip_token, array_merge($data, ['aps' => (object) []]));
        if (in_array($response->json('reason'), ['Unregistered', 'BadDeviceToken'])) {
            DB::table('devices')->where('id', $device->id)->where('voip_token', $device->getRawOriginal('voip_token'))->update(['voip_token' => null]);

            return;
        }
        $response->throw();
    }
}
