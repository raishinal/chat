import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCallIceSender } from '../resources/js/lib/call-ice-sender.ts';

test('an ICE burst sends one HTTP request at a time in candidate order', async () => {
    const sent = [];
    let finish;
    const sender = createCallIceSender((candidate) => {
        sent.push(candidate);
        return new Promise((resolve) => {
            finish = resolve;
        });
    }, assert.fail);
    const first = sender.enqueue('first');
    const second = sender.enqueue('second');
    await Promise.resolve();
    assert.deepEqual(sent, ['first']);
    finish();
    await first;
    await Promise.resolve();
    assert.deepEqual(sent, ['first', 'second']);
    finish();
    await second;
});

test('a failed request is reported without discarding later candidates', async () => {
    const sent = [],
        errors = [];
    const sender = createCallIceSender(
        async (candidate) => {
            sent.push(candidate);
            if (candidate === 1)
                throw Object.assign(new Error('Forbidden'), { status: 403 });
        },
        (error) => errors.push(error.message),
    );
    void sender.enqueue(1);
    await sender.enqueue(2);
    assert.deepEqual(sent, [1, 2]);
    assert.deepEqual(errors, ['Forbidden']);
});

test('hang-up aborts the active request and discards queued and late candidates', async () => {
    const sent = [];
    let activeSignal;
    const sender = createCallIceSender((candidate, signal) => {
        sent.push(candidate);
        activeSignal = signal;
        return new Promise((_, reject) => {
            signal.addEventListener(
                'abort',
                () => reject(new Error('Aborted')),
                { once: true },
            );
        });
    }, assert.fail);
    void sender.enqueue(1);
    const queued = sender.enqueue(2);
    await Promise.resolve();
    sender.stop();
    assert.equal(activeSignal.aborted, true);
    await queued;
    await sender.enqueue(3);
    assert.deepEqual(sent, [1]);
});
