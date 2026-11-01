<?php

use App\Events\ChatEvent;
use App\Events\SignalEvent;
use App\Models\Attachment;
use App\Models\Call;
use App\Models\ChatNotification;
use App\Models\Conversation;
use App\Models\Invitation;
use App\Models\Message;
use App\Models\User;
use App\Notifications\AccountInvitation;
use App\Policies\ConversationPolicy;
use App\Services\Invitations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

function pair(): array
{
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = Conversation::create(['user_one_id' => $a->id, 'user_two_id' => $b->id]);

    return [$a, $b, $c];
}
function admin(): User
{
    $u = User::factory()->create();
    $u->forceFill(['role' => 'admin'])->save();

    return $u;
}

test('registration is unavailable and API requires authentication', function () {
    $this->get('/register')->assertNotFound();
    $this->postJson('/register', [])->assertNotFound();
    $this->getJson('/api/v1/conversations')->assertUnauthorized();
});
test('mobile login enforces account status and tokens can be revoked', function () {
    $u = User::factory()->create();
    $token = $this->postJson('/api/v1/tokens', ['email' => $u->email, 'password' => 'password', 'device_name' => 'test'])->assertOk()->json('token');
    $this->withToken($token)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $u->id);
    $this->withToken($token)->deleteJson('/api/v1/tokens/current')->assertNoContent();
    expect($u->tokens()->count())->toBe(0);
    $u->forceFill(['status' => 'pending'])->save();
    $this->postJson('/api/v1/tokens', ['email' => $u->email, 'password' => 'password', 'device_name' => 'test'])->assertUnprocessable();
    $this->post('/login', ['email' => $u->email, 'password' => 'password'])->assertSessionHasErrors('email');
});
test('only admins can directly create active users with a password', function () {
    Notification::fake();
    $payload = ['name' => 'New member', 'email' => 'direct@example.test', 'role' => 'user', 'password' => 'long-safe-password', 'password_confirmation' => 'long-safe-password'];
    $this->actingAs(User::factory()->create())->postJson('/api/v1/admin/users', $payload)->assertForbidden();
    $a = admin();
    $id = $this->actingAs($a)->postJson('/api/v1/admin/users', $payload)->assertCreated()->assertJsonMissingPath('data.password')->json('data.id');
    $u = User::findOrFail($id);
    expect($u->status)->toBe('active');
    expect(Hash::check('long-safe-password', $u->password))->toBeTrue();
    expect($u->email_verified_at)->not->toBeNull();
    Notification::assertNothingSent();
    $this->assertDatabaseMissing('invitations', ['user_id' => $id]);
    $this->assertDatabaseHas('audit_logs', ['actor_id' => $a->id, 'subject_id' => $id, 'action' => 'user.created']);
});

test('expired and replaced invitation secrets cannot activate accounts', function () {
    Notification::fake();
    $u = User::factory()->create(['email' => 'pending@example.test']);
    $u->forceFill(['status' => 'pending'])->save();
    app(Invitations::class)->send($u);
    $old = Notification::sent($u, AccountInvitation::class)->first()->url;
    parse_str(parse_url($old, PHP_URL_QUERY), $q);
    $i = Invitation::where('user_id', $u->id)->first();
    $i->update(['expires_at' => now()->subMinute()]);
    $this->postJson('/api/v1/invitations/'.$i->id.'/accept', ['token' => $q['token'], 'password' => 'long-safe-password', 'password_confirmation' => 'long-safe-password'])->assertStatus(410);
    app(Invitations::class)->send($u);
    $this->postJson('/api/v1/invitations/'.$i->id.'/accept', ['token' => $q['token'], 'password' => 'long-safe-password', 'password_confirmation' => 'long-safe-password'])->assertStatus(410);
});
test('last active admin and self suspension are protected', function () {
    $a = admin();
    $this->actingAs($a)->patchJson('/api/v1/admin/users/'.$a->id, ['name' => $a->name, 'email' => $a->email, 'role' => 'user'])->assertUnprocessable();
    $this->patchJson('/api/v1/admin/users/'.$a->id, ['name' => $a->name, 'email' => $a->email, 'role' => 'admin', 'status' => 'suspended'])->assertUnprocessable();
    expect($a->fresh()->role)->toBe('admin');
});
test('suspension revokes sessions and tokens and blocks API and channel auth', function () {
    $a = admin();
    $u = User::factory()->create();
    $u->createToken('phone');
    DB::table('sessions')->insert(['id' => 'test-session', 'user_id' => $u->id, 'payload' => '', 'last_activity' => time()]);
    $this->actingAs($a)->patchJson('/api/v1/admin/users/'.$u->id, ['name' => $u->name, 'email' => $u->email, 'role' => 'user', 'status' => 'suspended'])->assertOk();
    expect($u->tokens()->count())->toBe(0);
    $this->assertDatabaseMissing('sessions', ['id' => 'test-session']);
    $this->actingAs($u->fresh())->getJson('/api/v1/conversations')->assertForbidden();
    $this->actingAs($u->fresh())->postJson('/api/v1/broadcasting/auth', ['socket_id' => '123.456', 'channel_name' => 'private-v1.users.'.$u->id])->assertForbidden();
});
test('conversations are unique in either participant order and private even from admins', function () {
    [$a,$b,$c] = pair();
    $this->actingAs($a)->postJson('/api/v1/conversations', ['user_id' => $b->id])->assertOk()->assertJsonPath('data.id', $c->id);
    $this->actingAs($b)->postJson('/api/v1/conversations', ['user_id' => $a->id])->assertOk()->assertJsonPath('data.id', $c->id);
    expect(Conversation::count())->toBe(1);
    $this->actingAs(admin())->getJson('/api/v1/conversations/'.$c->id.'/messages')->assertForbidden();
});
test('message retries are idempotent and read cursors are monotonic', function () {
    [$a,$b,$c] = pair();
    $payload = ['client_id' => (string) Str::uuid(), 'body' => 'Hello'];
    $id = $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/messages', $payload)->assertCreated()->json('data.id');
    $this->postJson('/api/v1/conversations/'.$c->id.'/messages', $payload)->assertOk()->assertJsonPath('data.id', $id);
    expect(Message::count())->toBe(1);
    expect(ChatNotification::count())->toBe(1);
    $this->actingAs($b)->getJson('/api/v1/conversations/'.$c->id)->assertJsonPath('data.unread_count', 1);
    $this->postJson('/api/v1/conversations/'.$c->id.'/read', ['message_id' => $id])->assertNoContent();
    $this->postJson('/api/v1/conversations/'.$c->id.'/read', ['message_id' => 0])->assertNoContent();
    $this->getJson('/api/v1/conversations/'.$c->id)->assertJsonPath('data.unread_count', 0)->assertJsonPath('data.read_id', $id);
});
test('message history uses stable cursor pagination without overlap', function () {
    [$a,$b,$c] = pair();
    for ($n = 0; $n < 43; $n++) {
        $c->messages()->create(['sender_id' => $a->id, 'client_id' => (string) Str::uuid(), 'body' => 'Message '.$n]);
    }$page = $this->actingAs($b)->getJson('/api/v1/conversations/'.$c->id.'/messages')->assertOk();
    expect($page->json('data'))->toHaveCount(40);
    $next = $this->getJson($page->json('links.next'))->assertOk();
    expect($next->json('data'))->toHaveCount(3);
    expect(array_intersect(array_column($page->json('data'), 'id'), array_column($next->json('data'), 'id')))->toBe([]);
});
test('notifications are owned by the recipient and read state persists', function () {
    [$a,$b,$c] = pair();
    $notice = ChatNotification::create(['user_id' => $b->id, 'kind' => 'message', 'data' => ['conversation_id' => $c->id]]);
    $this->actingAs($a)->patchJson('/api/v1/notifications/'.$notice->id.'/read')->assertNotFound();
    $this->getJson('/api/v1/notifications')->assertJsonCount(0, 'data');
    $this->actingAs($b)->patchJson('/api/v1/notifications/'.$notice->id.'/read')->assertNoContent();
    expect($notice->fresh()->read_at)->not->toBeNull();
});
test('uploads accept unknown types and multiple files but enforce membership and ownership', function () {
    Storage::fake('local');
    [$a,$b,$c] = pair();
    $outsider = User::factory()->create();
    $this->actingAs($outsider)->postJson('/api/v1/conversations/'.$c->id.'/attachments', ['files' => [UploadedFile::fake()->create('unknown.xyz', 2)]])->assertForbidden();
    $response = $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/attachments', ['files' => [UploadedFile::fake()->create('unknown.xyz', 2), UploadedFile::fake()->create('archive.zip', 2)]])->assertOk()->assertJsonCount(2, 'data');
    $id = $response->json('data.0.id');
    $this->actingAs($b)->postJson('/api/v1/conversations/'.$c->id.'/messages', ['client_id' => (string) Str::uuid(), 'attachment_ids' => [$id]])->assertUnprocessable();
    $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/messages', ['client_id' => (string) Str::uuid(), 'attachment_ids' => array_column($response->json('data'), 'id')])->assertCreated()->assertJsonCount(2, 'data.attachments');
    $this->actingAs($outsider)->getJson('/api/v1/attachments/'.$id)->assertForbidden();
});
test('attachment limits and active content download disposition are enforced', function () {
    Storage::fake('local');
    [$a,$b,$c] = pair();
    config(['chat.max_file_kb' => 1]);
    $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/attachments', ['files' => [UploadedFile::fake()->create('large.zip', 2)]])->assertUnprocessable();
    config(['chat.storage_limit_bytes' => 1]);
    $this->postJson('/api/v1/conversations/'.$c->id.'/attachments', ['files' => [UploadedFile::fake()->create('small.xyz', 1)]])->assertUnprocessable();
    Storage::disk('local')->put('attachments/unsafe', '<script>alert(1)</script>');
    $f = Attachment::create(['conversation_id' => $c->id, 'user_id' => $a->id, 'disk' => 'local', 'path' => 'attachments/unsafe', 'name' => 'evil.svg', 'mime' => 'image/svg+xml', 'size' => 25]);
    $this->actingAs($b)->get('/api/v1/attachments/'.$f->id)->assertOk()->assertHeader('Content-Type', 'application/octet-stream')->assertHeader('X-Content-Type-Options', 'nosniff');
});
test('video supports byte ranges and rejects unsatisfiable ranges', function () {
    Storage::fake('local');
    [$a,$b,$c] = pair();
    Storage::disk('local')->put('attachments/video', '0123456789');
    $f = Attachment::create(['conversation_id' => $c->id, 'user_id' => $a->id, 'disk' => 'local', 'path' => 'attachments/video', 'name' => 'video.mp4', 'mime' => 'video/mp4', 'size' => 10]);
    $this->actingAs($b)->withHeader('Range', 'bytes=2-5')->get('/api/v1/attachments/'.$f->id)->assertStatus(206)->assertHeader('Content-Range', 'bytes 2-5/10')->assertStreamedContent('2345');
    $this->withHeader('Range', 'bytes=99-100')->get('/api/v1/attachments/'.$f->id)->assertStatus(416);
});
test('calls enforce participants transitions overlapping locks and timeout cleanup', function () {
    [$a,$b,$c] = pair();
    $id = $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/calls', ['kind' => 'audio'])->assertCreated()->json('data.id');
    $this->patchJson('/api/v1/calls/'.$id, ['action' => 'accept'])->assertConflict();
    $this->actingAs(User::factory()->create())->patchJson('/api/v1/calls/'.$id, ['action' => 'end'])->assertNotFound();
    $this->actingAs($b)->postJson('/api/v1/conversations/'.$c->id.'/calls', ['kind' => 'video'])->assertConflict();
    $this->patchJson('/api/v1/calls/'.$id, ['action' => 'accept'])->assertOk()->assertJsonPath('data.status', 'accepted');
    $this->patchJson('/api/v1/calls/'.$id, ['action' => 'connected'])->assertOk()->assertJsonPath('data.status', 'connected');
    $this->travel(2)->minutes();
    $this->artisan('chat:cleanup')->assertSuccessful();
    expect(Call::find($id)->status)->toBe('timeout');
    expect(DB::table('active_calls')->count())->toBe(0);
});
test('unanswered calls become missed and release both participants', function () {
    [$a,$b,$c] = pair();
    $id = $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/calls', ['kind' => 'video'])->assertCreated()->json('data.id');
    $this->travel(46)->seconds();
    $this->artisan('chat:cleanup')->assertSuccessful();
    expect(Call::find($id)->status)->toBe('missed');
    $this->assertDatabaseHas('chat_notifications', ['user_id' => $b->id, 'kind' => 'missed_call']);
    expect(DB::table('active_calls')->count())->toBe(0);
});
test('conversation policy does not grant admins privileged access', function () {
    [$a,$b,$c] = pair();
    $policy = new ConversationPolicy;
    expect($policy->view($a, $c))->toBeTrue();
    expect($policy->view($b, $c))->toBeTrue();
    expect($policy->view(admin(), $c))->toBeFalse();
    $a->forceFill(['status' => 'suspended'])->save();
    expect($policy->view($a, $c))->toBeFalse();
});
test('channel callbacks authorize only active members and own user channels', function () {
    [$a,$b,$c] = pair();
    $channels = Broadcast::getChannels();
    $own = $channels['v1.users.{id}'];
    $conversation = $channels['v1.conversations.{id}'];
    $presence = $channels['v1.presence'];
    expect($own($a, $a->id))->toBeTrue();
    expect($own($b, $a->id))->toBeFalse();
    expect($conversation($a, $c->id))->toBeTrue();
    expect($conversation(admin(), $c->id))->toBeFalse();
    expect($presence($a))->toMatchArray(['id' => $a->id]);
    $a->forceFill(['status' => 'suspended'])->save();
    expect($presence($a))->toBeFalse();
});

test('new conversations immediately serialize zero read counters', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->actingAs($a)->postJson('/api/v1/conversations', ['user_id' => $b->id])->assertCreated()->assertJsonPath('data.read_id', 0)->assertJsonPath('data.peer_read_id', 0)->assertJsonPath('data.unread_count', 0);
});
test('one surviving caller cannot renew an absent callee indefinitely', function () {
    [$a,$b,$c] = pair();
    $id = $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/calls', ['kind' => 'audio'])->json('data.id');
    $this->actingAs($b)->patchJson('/api/v1/calls/'.$id, ['action' => 'accept'])->assertOk();
    $this->travel(60)->seconds();
    $this->actingAs($a)->patchJson('/api/v1/calls/'.$id, ['action' => 'heartbeat'])->assertOk();
    $this->travel(31)->seconds();
    $this->artisan('chat:cleanup')->assertSuccessful();
    expect(Call::find($id)->status)->toBe('timeout');
});
test('signaling validates participants roles and payloads without persisting SDP', function () {
    [$a,$b,$c] = pair();
    $call = Call::create(['conversation_id' => $c->id, 'caller_id' => $a->id, 'callee_id' => $b->id, 'kind' => 'audio', 'status' => 'accepted', 'expires_at' => now()->addMinute()]);
    config(['broadcasting.default' => 'pusher']);
    Event::fake([SignalEvent::class]);
    $payload = ['type' => 'offer', 'payload' => ['type' => 'offer', 'sdp' => 'v=0']];
    $this->actingAs(User::factory()->create())->postJson('/api/v1/calls/'.$call->id.'/signal', $payload)->assertNotFound();
    $this->actingAs($b)->postJson('/api/v1/calls/'.$call->id.'/signal', $payload)->assertForbidden();
    $this->actingAs($a)->postJson('/api/v1/calls/'.$call->id.'/signal', ['type' => 'offer', 'payload' => ['arbitrary' => 'bad']])->assertUnprocessable();
    $this->postJson('/api/v1/calls/'.$call->id.'/signal', $payload)->assertNoContent();
    Event::assertDispatched(SignalEvent::class);
    expect(Message::count())->toBe(0);
});
test('signaling preserves SDP line endings through every broadcast chunk', function (string $type) {
    [$a, $b, $conversation] = pair();
    $call = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $a->id, 'callee_id' => $b->id, 'kind' => 'video', 'status' => 'accepted', 'expires_at' => now()->addMinute()]);
    config(['broadcasting.default' => 'pusher']);
    Event::fake([SignalEvent::class]);
    $sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
        .str_repeat("a=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid\r\n", 150)
        ."a=ssrc:1881753626 msid:b2932270-5aa7-4116-a695-ea423b4402e9 bcdec864-d9c9-4745-8036-603ef3c40a8e\r\n";
    $payload = ['type' => $type, 'sdp' => $sdp];

    $this->actingAs($type === 'offer' ? $a : $b)
        ->postJson('/api/v1/calls/'.$call->id.'/signal', ['type' => $type, 'payload' => $payload])
        ->assertNoContent();

    $events = Event::dispatched(SignalEvent::class);
    expect($events->count())->toBeGreaterThan(1);
    $chunks = [];
    foreach ($events as [$event]) {
        $data = $event->broadcastWith()['data'];
        $chunks[$data['index']] = $data['chunk'];
    }
    ksort($chunks);
    $received = json_decode(base64_decode(implode('', $chunks), true), true, flags: JSON_THROW_ON_ERROR);
    expect($received)->toBe($payload);
})->with(['offer', 'answer']);

test('ICE signaling forwards candidates and end-of-candidates markers', function (string $candidate) {
    [$a, $b, $conversation] = pair();
    $call = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $a->id, 'callee_id' => $b->id, 'kind' => 'audio', 'status' => 'accepted', 'expires_at' => now()->addMinute()]);
    config(['broadcasting.default' => 'pusher']);
    Event::fake([SignalEvent::class]);
    $payload = ['candidate' => $candidate, 'sdpMid' => '0', 'sdpMLineIndex' => 0];

    $this->actingAs($a)->postJson('/api/v1/calls/'.$call->id.'/signal', ['type' => 'ice', 'payload' => $payload])->assertNoContent();

    Event::assertDispatched(SignalEvent::class, function (SignalEvent $event) use ($payload) {
        $data = $event->broadcastWith()['data'];

        return $data['type'] === 'ice'
            && json_decode(base64_decode($data['chunk'], true), true, flags: JSON_THROW_ON_ERROR) === $payload;
    });
})->with([
    'relay candidate' => ['candidate:1 1 udp 1677734911 192.0.2.1 3478 typ relay raddr 0.0.0.0 rport 0'],
    'end of candidates' => [''],
]);

test('ICE signaling rejects a missing or malformed candidate with 422', function (array $payload) {
    [$a, $b, $conversation] = pair();
    $call = Call::create(['conversation_id' => $conversation->id, 'caller_id' => $a->id, 'callee_id' => $b->id, 'kind' => 'audio', 'status' => 'accepted', 'expires_at' => now()->addMinute()]);
    config(['broadcasting.default' => 'pusher']);
    Event::fake([SignalEvent::class]);

    $this->actingAs($a)->postJson('/api/v1/calls/'.$call->id.'/signal', ['type' => 'ice', 'payload' => $payload])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('payload.candidate');

    Event::assertNotDispatched(SignalEvent::class);
})->with([
    'missing candidate' => [['sdpMid' => '0']],
    'malformed candidate' => [['candidate' => ['unexpected']]],
]);

test('actual private and presence auth endpoints reject outsiders', function () {
    [$a,$b,$c] = pair();
    config(['broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.key' => 'test-key', 'broadcasting.connections.pusher.secret' => 'test-secret', 'broadcasting.connections.pusher.app_id' => 'test-app']);
    require base_path('routes/channels.php');
    $this->actingAs($a)->postJson('/api/v1/broadcasting/auth', ['socket_id' => '123.456', 'channel_name' => 'private-v1.conversations.'.$c->id])->assertOk()->assertJsonStructure(['auth']);
    $this->postJson('/api/v1/broadcasting/auth', ['socket_id' => '123.456', 'channel_name' => 'presence-v1.presence'])->assertOk()->assertJsonStructure(['auth', 'channel_data']);
    $this->actingAs(User::factory()->create())->postJson('/api/v1/broadcasting/auth', ['socket_id' => '123.456', 'channel_name' => 'private-v1.conversations.'.$c->id])->assertForbidden();
});
test('message reconnect queries bridge more than one cursor page', function () {
    [$a,$b,$c] = pair();
    $first = $c->messages()->create(['sender_id' => $a->id, 'client_id' => (string) Str::uuid(), 'body' => 'first']);
    for ($n = 0; $n < 42; $n++) {
        $c->messages()->create(['sender_id' => $a->id, 'client_id' => (string) Str::uuid(), 'body' => 'later']);
    }$response = $this->actingAs($b)->getJson('/api/v1/conversations/'.$c->id.'/messages?after_id='.$first->id)->assertOk();
    expect($response->json('data'))->toHaveCount(40);
    expect($response->json('data.0.id'))->toBe($first->id + 1);
    $this->getJson($response->json('links.next'))->assertOk()->assertJsonCount(2, 'data');
});
test('abandoned uploads and orphan objects are cleaned but committed files are retained', function () {
    Storage::fake('local');
    [$a,$b,$c] = pair();
    $m = $c->messages()->create(['sender_id' => $a->id, 'client_id' => (string) Str::uuid(), 'body' => 'keep']);
    foreach (['abandoned', 'kept'] as $name) {
        Storage::disk('local')->put('attachments/'.$name, 'bytes');
        Attachment::create(['conversation_id' => $c->id, 'user_id' => $a->id, 'message_id' => $name === 'kept' ? $m->id : null, 'disk' => 'local', 'path' => 'attachments/'.$name, 'name' => $name, 'mime' => 'text/plain', 'size' => 5, 'created_at' => now()->subDays(2)]);
    } $this->artisan('chat:cleanup')->assertSuccessful();
    Storage::disk('local')->assertMissing('attachments/abandoned');
    Storage::disk('local')->assertExists('attachments/kept');
    $this->assertDatabaseCount('attachments', 1);
});
test('attachment count is enforced even for otherwise valid files', function () {
    Storage::fake('local');
    [$a,$b,$c] = pair();
    config(['chat.max_attachments' => 1]);
    $this->actingAs($a)->postJson('/api/v1/conversations/'.$c->id.'/attachments', ['files' => [UploadedFile::fake()->create('one.xyz', 1), UploadedFile::fake()->create('two.xyz', 1)]])->assertUnprocessable()->assertJsonValidationErrors('files');
    $this->assertDatabaseCount('attachments', 0);
});

test('native password reset consumes the token and revokes existing sessions and tokens', function () {
    $u = User::factory()->create();
    $u->createToken('old phone');
    $token = Password::createToken($u);
    $payload = ['email' => $u->email, 'token' => $token, 'password' => 'long-new-password', 'password_confirmation' => 'long-new-password'];
    $this->postJson('/api/v1/reset-password', $payload)->assertOk();
    expect($u->tokens()->count())->toBe(0);
    expect(Hash::check('long-new-password', $u->fresh()->password))->toBeTrue();
    $this->postJson('/api/v1/reset-password', $payload)->assertUnprocessable();
});

test('disabled broadcasters return a clear service error instead of an empty auth response', function () {
    $user = User::factory()->create();
    config(['broadcasting.default' => 'log']);
    $this->actingAs($user)->postJson('/api/v1/broadcasting/auth', ['socket_id' => '123.456', 'channel_name' => 'private-v1.users.'.$user->id])
        ->assertStatus(503)->assertJsonPath('message', 'The running Laravel server has not enabled Pusher. Restart the Laravel server and queue worker after updating BROADCAST_CONNECTION=pusher.');
});

test('typing limits are independent of ordinary API traffic and other conversations', function () {
    [$a,$b,$c] = pair();
    $this->actingAs($a);
    for ($i = 0; $i < 20; $i++) {
        $this->getJson('/api/v1/me')->assertOk();
    }
    for ($i = 0; $i < 12; $i++) {
        $this->postJson('/api/v1/conversations/'.$c->id.'/typing')->assertNoContent();
    }
    $this->postJson('/api/v1/conversations/'.$c->id.'/typing')->assertTooManyRequests();
    $this->getJson('/api/v1/me')->assertOk();
    $peer = User::factory()->create();
    $other = Conversation::create(['user_one_id' => $a->id, 'user_two_id' => $peer->id]);
    $this->postJson('/api/v1/conversations/'.$other->id.'/typing')->assertNoContent();
    $this->actingAs($b)->postJson('/api/v1/conversations/'.$c->id.'/typing')->assertNoContent();
});

test('repeated hang-ups from both participants succeed without rewriting final call history', function () {
    [$a,$b,$c] = pair();
    $call = Call::create(['conversation_id' => $c->id, 'caller_id' => $a->id, 'callee_id' => $b->id, 'kind' => 'audio', 'status' => 'connected', 'connected_at' => now(), 'expires_at' => now()->addMinute()]);
    DB::table('active_calls')->insert([['user_id' => $a->id, 'call_id' => $call->id], ['user_id' => $b->id, 'call_id' => $call->id]]);
    $this->actingAs($a)->patchJson('/api/v1/calls/'.$call->id, ['action' => 'end'])->assertOk()->assertJsonPath('data.status', 'ended');
    $ended = $call->fresh()->ended_at;
    Event::fake([ChatEvent::class]);
    $this->actingAs($b)->patchJson('/api/v1/calls/'.$call->id, ['action' => 'end'])->assertOk()->assertJsonPath('data.status', 'ended');
    $this->patchJson('/api/v1/calls/'.$call->id, ['action' => 'failed'])->assertOk()->assertJsonPath('data.status', 'ended');
    $this->patchJson('/api/v1/calls/'.$call->id, ['action' => 'accept'])->assertConflict();
    expect($call->fresh()->ended_at->equalTo($ended))->toBeTrue();
    expect(DB::table('active_calls')->count())->toBe(0);
    Event::assertNotDispatched(ChatEvent::class);
});
