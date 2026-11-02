import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    tuneCallVideo,
    callVideoConstraints,
    acquireCallMedia,
} from '../resources/js/lib/call-media.ts';

test('high quality is opt-in and can switch back to the performance encoding', async () => {
    const parameters = { encodings: [{ active: true }] };
    const peer = {
        getSenders: () => [
            {
                track: { kind: 'video' },
                getParameters: () => parameters,
                async setParameters() {},
            },
        ],
    };
    await tuneCallVideo(peer, 'high');
    assert.equal(parameters.encodings[0].maxBitrate, 12000000);
    assert.equal(parameters.encodings[0].maxFramerate, 30);
    assert.equal(parameters.degradationPreference, 'maintain-resolution');
    await tuneCallVideo(peer, 'performance');
    assert.equal(parameters.encodings[0].maxBitrate, 1000000);
    assert.equal(parameters.encodings[0].maxFramerate, 24);
    assert.equal(parameters.degradationPreference, 'maintain-framerate');
});

test('the chosen quality configures capture without requiring an unsupported camera resolution', async () => {
    const requests = [];
    const mic = { kind: 'audio', readyState: 'live' };
    const camera = { kind: 'video', readyState: 'live' };
    const tracks = [mic];
    await acquireCallMedia(
        true,
        {
            async getUserMedia(constraints) {
                requests.push(constraints);
                return constraints.video
                    ? { getTracks: () => [camera] }
                    : {
                          getTracks: () => tracks,
                          getAudioTracks: () => [mic],
                          addTrack: (track) => tracks.push(track),
                      };
            },
        },
        undefined,
        'high',
    );
    assert.deepEqual(requests[1].video, {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
    });
    assert.deepEqual(callVideoConstraints('performance'), {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24, max: 24 },
    });
    assert.deepEqual(tracks, [mic, camera]);
});

test('performance tuning preserves negotiated encodings and leaves audio alone', async () => {
    const parameters = {
        transactionId: 'negotiated',
        encodings: [{ active: true, rid: 'camera' }],
    };
    let applied;
    await tuneCallVideo({
        getSenders: () => [
            {
                track: { kind: 'audio' },
                getParameters() {
                    assert.fail('audio must keep its defaults');
                },
            },
            {
                track: { kind: 'video' },
                getParameters: () => parameters,
                async setParameters(value) {
                    applied = value;
                },
            },
        ],
    });
    assert.equal(applied, parameters);
    assert.equal(applied.transactionId, 'negotiated');
    assert.equal(applied.encodings.length, 1);
    assert.equal(applied.encodings[0].rid, 'camera');
    assert.equal(applied.encodings[0].maxBitrate, 1000000);
    assert.equal(applied.encodings[0].scaleResolutionDownBy, 1);
    assert.equal(applied.degradationPreference, 'maintain-framerate');
});

test('unsupported video tuning and empty negotiated encodings do not fail calls', async () => {
    await assert.doesNotReject(
        tuneCallVideo({
            getSenders: () => [
                {
                    track: { kind: 'video' },
                    getParameters: () => ({ encodings: [{}] }),
                    async setParameters() {
                        throw new Error('Unsupported');
                    },
                },
                {
                    track: { kind: 'video' },
                    getParameters: () => ({ encodings: [] }),
                    async setParameters() {
                        assert.fail('must not invent encodings');
                    },
                },
            ],
        }),
    );
});
