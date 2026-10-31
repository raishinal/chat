<?php

use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    config(['chat.cloudflare_turn.key_id' => 'test-key-id', 'chat.cloudflare_turn.api_token' => 'permanent-test-secret', 'chat.cloudflare_turn.ttl' => 3600]);
});

function cloudflareIce(): array
{
    return ['iceServers' => [
        ['urls' => ['stun:stun.cloudflare.com:3478']],
        ['urls' => ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], 'username' => 'temporary-user', 'credential' => 'temporary-password', 'ignored' => 'provider-internal'],
    ], 'internal_token' => 'never-forward'];
}

test('active cookie users receive temporary Cloudflare credentials with private headers', function () {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response(cloudflareIce(), 201)]);
    $this->freezeTime();
    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertOk()
        ->assertJsonPath('ice_servers.1.credential', 'temporary-password')->assertJsonPath('expires_in', 3600)
        ->assertJsonPath('expires_at', now()->addHour()->toISOString());
    expect($response->headers->get('Cache-Control'))->toContain('private', 'no-store');
    expect($response->getContent())->not->toContain('permanent-test-secret', 'test-key-id', 'internal_token', 'provider-internal');
    Http::assertSent(fn (Request $r) => $r->url() === 'https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id/credentials/generate-ice-servers' && $r->method() === 'POST' && $r->hasHeader('Authorization', 'Bearer permanent-test-secret') && $r['ttl'] === 3600);
});

test('native bearer clients can obtain ICE configuration', function () {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response(cloudflareIce(), 201)]);
    $token = User::factory()->create()->createToken('native')->plainTextToken;
    $this->withToken($token)->getJson('/api/v1/ice-servers')->assertOk()->assertJsonPath('ice_servers.0.urls.0', 'stun:stun.cloudflare.com:3478');
    Http::assertSentCount(1);
});

test('anonymous pending and suspended users cannot mint TURN credentials', function () {
    Http::preventStrayRequests();
    Http::fake();
    $this->getJson('/api/v1/ice-servers')->assertUnauthorized();
    foreach (['pending', 'suspended'] as $status) {
        $u = User::factory()->create();
        $u->forceFill(['status' => $status])->save();
        $this->actingAs($u)->getJson('/api/v1/ice-servers')->assertForbidden();
    }
    Http::assertNothingSent();
});

test('missing backend configuration fails closed without an upstream call', function () {
    Http::preventStrayRequests();
    Http::fake();
    config(['chat.cloudflare_turn.api_token' => null]);
    $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertStatus(503)->assertJsonPath('message', 'Cloudflare TURN is not configured. Contact your administrator.');
    Http::assertNothingSent();
});

test('provider errors do not disclose upstream secrets', function (int $status) {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response(['error' => 'permanent-test-secret'], $status)]);
    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertStatus(503);
    expect($response->getContent())->not->toContain('permanent-test-secret');
    Http::assertSentCount(1);
})->with([401, 429, 500, 302]);

test('connection failures return a recoverable sanitized error', function () {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::failedConnection()]);
    $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertStatus(503)->assertJsonPath('message', 'Call connectivity is temporarily unavailable. Please retry.');
});

test('malformed or STUN-only provider responses fail closed', function (array $body) {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response($body, 201)]);
    $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertStatus(503);
    Http::assertSentCount(1);
})->with([
    'missing' => [[]],
    'invalid urls' => [['iceServers' => [['urls' => ['https://example.test']]]]],
    'no TURN' => [['iceServers' => [['urls' => ['stun:stun.cloudflare.com:3478']]]]],
    'missing credential' => [['iceServers' => [['urls' => ['turn:turn.cloudflare.com:3478'], 'username' => 'temporary']]]],
]);

test('configured TTL stays within the short-lived application policy', function (int $ttl, int $expected) {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response(cloudflareIce(), 201)]);
    config(['chat.cloudflare_turn.ttl' => $ttl]);
    $this->actingAs(User::factory()->create())->getJson('/api/v1/ice-servers')->assertOk()->assertJsonPath('expires_in', $expected);
    Http::assertSent(fn (Request $r) => $r['ttl'] === $expected);
})->with([[0, 60], [999999, 86400], [900, 900]]);

test('credential issuance has a per-account rate limit', function () {
    Http::preventStrayRequests();
    Http::fake(['rtc.live.cloudflare.com/*' => Http::response(cloudflareIce(), 201)]);
    $this->actingAs(User::factory()->create());
    for ($i = 0; $i < 10; $i++) {
        $this->getJson('/api/v1/ice-servers')->assertOk();
    }
    $this->getJson('/api/v1/ice-servers')->assertTooManyRequests();
    Http::assertSentCount(10);
});
