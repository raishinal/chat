import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryCallSignal } from '../resources/js/lib/call-signal-retry.ts';

test('temporary 500 and network failures retry the same signal with backoff', async () => {
    let attempts = 0;
    const waits = [];
    await retryCallSignal(
        async () => {
            attempts++;
            if (attempts === 1) throw { status: 500 };
            if (attempts === 2) throw new TypeError('Network error');
        },
        new AbortController().signal,
        async (ms) => {
            waits.push(ms);
        },
    );
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [500, 1000]);
});

test('persistent server failures stop after three attempts', async () => {
    let attempts = 0;
    await assert.rejects(
        retryCallSignal(
            async () => {
                attempts++;
                throw { status: 503 };
            },
            new AbortController().signal,
            async () => {},
        ),
        /signaling server after retrying/,
    );
    assert.equal(attempts, 3);
});

test('authentication, ended calls and invalid payloads are not retried', async () => {
    for (const status of [401, 403, 409, 422]) {
        let attempts = 0;
        const failure = Object.assign(new Error('Permanent failure'), {
            status,
        });
        await assert.rejects(
            retryCallSignal(
                async () => {
                    attempts++;
                    throw failure;
                },
                new AbortController().signal,
                async () => {
                    assert.fail();
                },
            ),
            (error) => error === failure,
        );
        assert.equal(attempts, 1);
    }
});

test('hang-up during backoff cancels the next attempt', async () => {
    const controller = new AbortController();
    let attempts = 0;
    await assert.rejects(
        retryCallSignal(
            async () => {
                attempts++;
                throw { status: 500 };
            },
            controller.signal,
            async () => {
                controller.abort();
            },
        ),
        { name: 'AbortError' },
    );
    assert.equal(attempts, 1);
});

test('a stalled HTTP request times out before the next attempt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let attempts = 0;
    const task = retryCallSignal(
        (signal) => {
            attempts++;
            if (attempts > 1) return Promise.resolve();
            return new Promise((_, reject) => {
                signal.addEventListener(
                    'abort',
                    () => reject(new Error('Timeout')),
                    { once: true },
                );
            });
        },
        new AbortController().signal,
        async () => {},
        8000,
    );
    t.mock.timers.tick(8000);
    await task;
    assert.equal(attempts, 2);
});
