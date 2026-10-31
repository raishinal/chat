<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;

test('changing a password requires an active authenticated account', function () {
    $this->putJson('/api/v1/profile/password')->assertUnauthorized();
    $user = User::factory()->create(['status' => 'suspended']);
    $this->actingAs($user)->putJson('/api/v1/profile/password')->assertForbidden();
});

test('invalid password changes leave credentials and tokens unchanged', function (array $changes, string $field) {
    $user = User::factory()->create(['password' => 'original-password']);
    $token = $user->createToken('existing')->accessToken;
    $this->actingAs($user)->putJson('/api/v1/profile/password', array_replace([
        'current_password' => 'original-password', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password',
    ], $changes))->assertUnprocessable()->assertJsonValidationErrors($field);
    expect(Hash::check('original-password', $user->fresh()->password))->toBeTrue();
    $this->assertDatabaseHas('personal_access_tokens', ['id' => $token->id]);
})->with([
    'incorrect current password' => [['current_password' => 'wrong-password'], 'current_password'],
    'missing current password' => [['current_password' => ''], 'current_password'],
    'short password' => [['password' => 'short', 'password_confirmation' => 'short'], 'password'],
    'confirmation mismatch' => [['password_confirmation' => 'different-password'], 'password'],
    'unchanged password' => [['password' => 'original-password', 'password_confirmation' => 'original-password'], 'password'],
]);

test('a bearer password change keeps only the current token and does not affect other users', function () {
    Queue::fake();
    config(['broadcasting.default' => 'pusher']);
    $user = User::factory()->create(['password' => 'original-password']);
    $current = $user->createToken('current');
    $other = $user->createToken('other')->accessToken;
    $peer = User::factory()->create();
    $peerToken = $peer->createToken('peer')->accessToken;
    DB::table('sessions')->insert(['id' => 'old-browser', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);

    $this->withToken($current->plainTextToken)->putJson('/api/v1/profile/password', [
        'current_password' => 'original-password', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password',
    ])->assertOk()->assertJsonPath('message', 'Password changed. Other devices have been signed out.');

    expect(Hash::check('replacement-password', $user->fresh()->password))->toBeTrue();
    expect(Hash::check('original-password', $user->fresh()->password))->toBeFalse();
    $this->assertDatabaseHas('personal_access_tokens', ['id' => $current->accessToken->id]);
    $this->assertDatabaseMissing('personal_access_tokens', ['id' => $other->id]);
    $this->assertDatabaseHas('personal_access_tokens', ['id' => $peerToken->id]);
    $this->assertDatabaseMissing('sessions', ['id' => 'old-browser']);
    $this->getJson('/api/v1/me')->assertOk();
    Queue::assertPushed(\App\Jobs\TerminateConnections::class);
});

test('browser password changes preserve the current browser session and revoke mobile tokens', function () {
    config(['broadcasting.default' => 'log', 'sanctum.stateful' => ['localhost:8000']]);
    $user = User::factory()->create(['password' => 'original-password']);
    $user->createToken('phone');
    $this->actingAs($user)->withHeader('Origin', 'http://localhost:8000')->withSession(['test' => true]);
    $id = session()->getId();
    $this->withCredentials()->withCookie(config('session.cookie'), $id);
    DB::table('sessions')->insert([
        ['id' => $id, 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'other-browser', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
    ]);

    $this->putJson('/api/v1/profile/password', ['current_password' => 'original-password', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password'])->assertOk();

    $this->assertDatabaseHas('sessions', ['id' => $id]);
    $this->assertDatabaseMissing('sessions', ['id' => 'other-browser']);
    expect($user->tokens()->count())->toBe(0);
    expect(session('password_hash_web'))->toBe(\Illuminate\Support\Facades\Auth::guard('web')->hashPasswordForCookie($user->fresh()->password));
});

test('password verification attempts are limited per account', function () {
    $user = User::factory()->create();
    $payload = ['current_password' => 'incorrect-password', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password'];
    $this->actingAs($user);
    for ($i = 0; $i < 6; $i++) {
        $this->putJson('/api/v1/profile/password', $payload)->assertUnprocessable();
    }
    $this->putJson('/api/v1/profile/password', $payload)->assertTooManyRequests();
    $this->actingAs(User::factory()->create())->putJson('/api/v1/profile/password', $payload)->assertUnprocessable();
});
