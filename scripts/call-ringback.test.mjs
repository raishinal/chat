import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCallRingback } from '../resources/js/lib/call-ringback.ts';

await test('ringback starts once, stops every active tone immediately, and releases audio on disposal', () => {
    const nodes = [];
    let closed = 0;
    const gainValue = { setValueAtTime() {}, linearRampToValueAtTime() {} };
    const audio = {
        state: 'running',
        currentTime: 0,
        destination: {},
        resume: async () => {},
        close: async () => {
            closed++;
        },
        createGain: () => ({ gain: gainValue, connect() {}, disconnect() {} }),
        createOscillator: () => {
            const node = {
                frequency: {},
                connect() {},
                disconnect() {},
                start() {},
                stops: [],
                stop(time) {
                    this.stops.push(time);
                },
            };
            nodes.push(node);
            return node;
        },
    };
    const ringback = createCallRingback(() => audio);
    try {
        void ringback.unlock();
        ringback.start();
        ringback.start();
        assert.equal(nodes.length, 2);
        ringback.stop();
        assert.deepEqual(
            nodes.map((n) => n.stops),
            [
                [2, undefined],
                [2, undefined],
            ],
        );
        ringback.start();
        assert.equal(nodes.length, 4);
    } finally {
        ringback.dispose();
    }
    assert.equal(closed, 1);
    assert.equal(nodes[2].stops.at(-1), undefined);
});

await test('unavailable synthesis does not prevent calls or leave timers behind', () => {
    const ringback = createCallRingback(() => {
        throw new Error('Unavailable');
    });
    void ringback.unlock();
    ringback.start();
    ringback.dispose();
});

await test('incoming ringtone schedules two loud bursts and cancels all tones on stop', () => {
    const nodes = [],
        levels = [];
    const audio = {
        state: 'running',
        currentTime: 0,
        destination: {},
        close: async () => {},
        createGain: () => ({
            gain: {
                setValueAtTime() {},
                linearRampToValueAtTime(value) {
                    levels.push(value);
                },
            },
            connect() {},
            disconnect() {},
        }),
        createOscillator: () => {
            const node = {
                frequency: {},
                starts: [],
                stops: [],
                start(time) {
                    this.starts.push(time);
                },
                stop(time) {
                    this.stops.push(time);
                },
                connect() {},
                disconnect() {},
            };
            nodes.push(node);
            return node;
        },
    };
    const ringtone = createCallRingback(() => audio, true);
    try {
        assert.equal(ringtone.isReady(), false);
        void ringtone.unlock();
        ringtone.start();
        assert.equal(ringtone.isReady(), true);
        assert.equal(nodes.length, 4);
        assert.deepEqual(
            nodes.map((node) => node.starts[0]),
            [0, 0, 0.65, 0.65],
        );
        assert.ok(levels.includes(0.18));
        ringtone.stop();
        assert.ok(nodes.every((node) => node.stops.at(-1) === undefined));
    } finally {
        ringtone.dispose();
    }
});

await test('stopping during browser audio unlock prevents a late ringtone', async () => {
    let resume;
    let oscillators = 0;
    const audio = {
        state: 'suspended',
        resume: () =>
            new Promise((resolve) => {
                resume = () => {
                    audio.state = 'running';
                    resolve();
                };
            }),
        close: async () => {},
        createOscillator: () => {
            oscillators++;
            throw new Error('Must not play');
        },
    };
    const ringtone = createCallRingback(() => audio, true);
    ringtone.start();
    ringtone.stop();
    resume();
    await new Promise(setImmediate);
    ringtone.dispose();
    assert.equal(oscillators, 0);
});
