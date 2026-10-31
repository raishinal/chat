import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createRealtimeRecovery,
    realtimeConnectionIssue,
} from '../resources/js/lib/realtime-recovery.ts';
function setup(getSession = async () => ({ id: 1 })) {
    let time = 0;
    const events = [];
    const channels = [
        {
            subscribed: true,
            subscriptionPending: false,
            subscribe() {
                events.push('unexpected-resubscribe');
            },
        },
        {
            subscribed: false,
            subscriptionPending: false,
            subscribe() {
                events.push('retry-channel');
                this.subscriptionPending = true;
            },
        },
        {
            subscribed: false,
            subscriptionPending: true,
            subscribe() {
                events.push('duplicate-subscribe');
            },
        },
    ];
    const client = {
        connection: { state: 'connected' },
        connect() {
            events.push('connect');
            this.connection.state = 'connecting';
        },
        disconnect() {
            events.push('disconnect');
            this.connection.state = 'disconnected';
        },
        allChannels() {
            return channels;
        },
    };
    const recovery = createRealtimeRecovery({
        client,
        getSession: async () => {
            events.push('session');
            return getSession();
        },
        onSession: () => events.push('authorized'),
        onExpired: () => events.push('expired'),
        onReconnect: () => events.push('reconnecting'),
        onIssue: () => events.push('issue'),
        onRefresh: () => events.push('refresh'),
        now: () => time,
    });
    return {
        client,
        recovery,
        events,
        advance: (ms) => {
            time += ms;
        },
    };
}
await test('a sleeping tab verifies its session then replaces a stale socket and reconciles', async () => {
    const { recovery, events, advance } = setup();
    advance(61000);
    await recovery.resume();
    assert.deepEqual(events, [
        'session',
        'authorized',
        'reconnecting',
        'disconnect',
        'connect',
        'refresh',
    ]);
});
await test('a healthy socket retries only failed subscriptions without disconnecting', async () => {
    const { recovery, events } = setup();
    await recovery.resume();
    assert.deepEqual(events, [
        'session',
        'authorized',
        'retry-channel',
        'refresh',
    ]);
});
await test('a restored network reconnects an unavailable socket', async () => {
    const { recovery, client, events } = setup();
    client.connection.state = 'unavailable';
    await recovery.resume();
    assert.ok(events.includes('connect'));
    assert.ok(!events.includes('disconnect'));
    assert.equal(events.at(-1), 'refresh');
});
for (const status of [401, 419, 403])
    await test(`HTTP ${status} ends recovery and asks for sign-in without reconnect loops`, async () => {
        const { recovery, events, advance } = setup(async () => {
            throw { status };
        });
        await recovery.resume();
        advance(61000);
        await recovery.resume();
        assert.deepEqual(events, ['session', 'disconnect', 'expired']);
    });
await test('temporary network failure can recover on the next wake', async () => {
    let attempts = 0;
    const { recovery, events, advance } = setup(async () => {
        if (attempts++ === 0) throw new Error('offline');
        return { id: 1 };
    });
    await recovery.resume();
    assert.equal(events.at(-1), 'issue');
    advance(6000);
    await recovery.resume();
    assert.equal(events.at(-1), 'refresh');
    assert.ok(!events.includes('expired'));
});
await test('overlapping focus and visibility events share one session request with cooldown', async () => {
    let resolve;
    const session = new Promise((r) => {
        resolve = r;
    });
    const { recovery, events } = setup(() => session);
    const first = recovery.resume(),
        second = recovery.resume();
    resolve({ id: 1 });
    await Promise.all([first, second]);
    await recovery.resume();
    assert.equal(events.filter((e) => e === 'session').length, 1);
    assert.equal(events.filter((e) => e === 'retry-channel').length, 1);
});
await test('unmounted pages cannot reconnect after a pending session check resolves', async () => {
    let resolve;
    const session = new Promise((r) => {
        resolve = r;
    });
    const { recovery, events } = setup(() => session);
    const pending = recovery.resume();
    recovery.dispose();
    resolve({ id: 1 });
    await pending;
    assert.deepEqual(events, ['session']);
});
await test('connection notices distinguish transient sleep interruptions from provider limits', () => {
    assert.match(realtimeConnectionIssue({}), /Reconnecting automatically/);
    assert.match(
        realtimeConnectionIssue({ error: { data: { code: 4004 } } }),
        /connection limit/,
    );
});
