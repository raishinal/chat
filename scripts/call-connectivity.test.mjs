import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCallConnectivityLoader } from '../resources/js/lib/call-connectivity.ts';

test('accepting during prefetch shares the pending TURN request', async () => {
    let requests = 0;
    let finish;
    const loader = createCallConnectivityLoader(() => {
        requests++;
        return new Promise((resolve) => { finish = resolve; });
    });
    const ringing = loader.load(1);
    const accepting = loader.load(1);
    assert.equal(ringing, accepting);
    await Promise.resolve();
    finish({ ice_servers: [] });
    assert.deepEqual(await accepting, { ice_servers: [] });
    assert.equal(requests, 1);
});

test('recent credentials are reused but older credentials are refreshed', async () => {
    let time = 0;
    let requests = 0;
    const loader = createCallConnectivityLoader(async () => ++requests, () => time);
    assert.equal(await loader.load(1), 1);
    time = 9999;
    assert.equal(await loader.load(1), 1);
    time = 10000;
    assert.equal(await loader.load(1), 2);
});

test('a different call never reuses the previous calls credentials', async () => {
    let requests = 0;
    const loader = createCallConnectivityLoader(async () => ++requests);
    assert.equal(await loader.load(1), 1);
    assert.equal(await loader.load(2), 2);
});

test('failed prefetches can be retried when accepting', async () => {
    let requests = 0;
    const loader = createCallConnectivityLoader(async () => {
        if (++requests === 1) throw new Error('Offline');
        return 'ready';
    });
    await assert.rejects(loader.load(1), /Offline/);
    assert.equal(await loader.load(1), 'ready');
});

test('hang-up aborts prefetch and clears its cached credentials', async () => {
    let signal;
    const loader = createCallConnectivityLoader(async (currentSignal) => {
        signal = currentSignal;
        return 'ready';
    });
    await loader.load(1);
    loader.clear();
    assert.equal(signal.aborted, true);
    assert.equal(await loader.load(1), 'ready');
    assert.equal(signal.aborted, false);
});
