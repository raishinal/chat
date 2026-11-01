<?php

use App\Jobs\SendDevicePush;
use App\Models\Call;
use App\Models\Conversation;
use App\Models\Device;
use App\Models\User;
use App\Services\NativePush;
use App\Services\Notifier;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

test('device registration requires a mobile login and reassigns an installation safely', function () {
    $one = User::factory()->create();
    $two = User::factory()->create();
    $device = (string) Str::uuid();
    $first = $one->createToken('phone');
    $second = $two->createToken('phone');
    $this->withToken($first->plainTextToken)->putJson('/api/v1/devices', ['device_id' => $device, 'platform' => 'android', 'push_token' => 'fcm-one'])->assertCreated();
    expect(Device::first()->push_token)->toBe('fcm-one');
    expect(Device::first()->getRawOriginal('push_token'))->not->toBe('fcm-one');
    auth()->forgetGuards();
    $this->withToken($second->plainTextToken)->putJson('/api/v1/devices', ['device_id' => $device, 'platform' => 'android', 'push_token' => 'fcm-two'])->assertCreated();
    expect(Device::count())->toBe(1);
    expect(Device::first()->user_id)->toBe($two->id);
    auth()->forgetGuards();
    $this->withToken($second->plainTextToken)->deleteJson('/api/v1/tokens/current')->assertNoContent();
    expect(Device::count())->toBe(0);
});

test('messages enqueue remote delivery while incoming call notices do not duplicate ringing', function () {
    Queue::fake();
    $user = User::factory()->create();
    app(Notifier::class)->send($user->id, 'message', ['conversation_id' => 1]);
    app(Notifier::class)->send($user->id, 'incoming_call', ['call_id' => 1]);
    Queue::assertPushed(SendDevicePush::class, 1);
    Queue::assertPushed(SendDevicePush::class, fn ($job) => $job->kind === 'message' && $job->afterCommit === true);
});

test('a delayed call job uses the cancelled state instead of ringing', function () {
    $caller = User::factory()->create();
    $callee = User::factory()->create();
    $conversation = Conversation::create(['user_one_id' => $caller->id, 'user_two_id' => $callee->id]);
    $call = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $caller->id, 'callee_id' => $callee->id, 'kind' => 'audio', 'status' => 'ringing', 'expires_at' => now()->addSeconds(30)]);
    $job = new SendDevicePush($callee->id, 'call', ['call_id' => $call->id]);
    $call->update(['status' => 'cancelled', 'ended_at' => now()]);
    $push = Mockery::mock(NativePush::class);
    $push->shouldReceive('send')->once()->withArgs(fn ($id, $kind, $data) => $id === $callee->id && $kind === 'call' && $data['status'] === 'cancelled' && $data['uuid'] === sprintf('00000000-0000-4000-8000-%012x', $call->id));
    $job->handle($push);
});

test('FCM sends generic previews only to active unexpired logins', function () {
    Http::fake(['fcm.googleapis.com/*' => Http::response(['name' => 'message-id'])]);
    $path = tempnam(sys_get_temp_dir(), 'relay-push-test-');
    file_put_contents($path, json_encode(['project_id' => 'relay-test']));
    config(['push.firebase_credentials' => $path]);
    Cache::put('push.fcm.'.hash('sha256', $path), 'access-token', 3000);
    try {
        $user = User::factory()->create();
        $valid = $user->createToken('phone', ['chat'], now()->addDay());
        $expired = $user->createToken('old', ['chat'], now()->subDay());
        foreach ([$valid, $expired] as $index => $token) {
            Device::create(['user_id' => $user->id, 'device_id' => (string) Str::uuid(), 'platform' => 'android', 'personal_access_token_id' => $token->accessToken->id, 'push_token' => 'device-'.$index]);
        }
        app(NativePush::class)->send($user->id, 'message', ['conversation_id' => 42, 'sender_name' => 'Friend']);
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request['message']['token'] === 'device-0' && $request['message']['data']['conversation_id'] === '42' && $request['message']['notification']['body'] === 'New message');
    } finally {
        unlink($path);
    }
});
