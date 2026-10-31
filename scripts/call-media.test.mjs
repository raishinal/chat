import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    acquireCallMedia,
    releaseCallMedia,
    addRemoteTrack,
    callSeconds,
} from '../resources/js/lib/call-media.ts';
function track(kind) {
    return {
        kind,
        readyState: 'live',
        stop() {
            this.readyState = 'ended';
        },
    };
}
function stream(...tracks) {
    return {
        getTracks: () => tracks,
        getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
        getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
        addTrack: (t) => tracks.push(t),
    };
}

await test('a streamless video track does not replace remote audio and duplicate tracks are ignored', () => {
    const mic = { ...track('audio'), id: 'remote-audio' };
    const camera = { ...track('video'), id: 'remote-video' };
    const remote = stream();
    addRemoteTrack(remote, mic);
    addRemoteTrack(remote, camera);
    addRemoteTrack(remote, mic);
    assert.deepEqual(remote.getTracks(), [mic, camera]);
});

await test('call timer advances from local media connection before server status arrives and freezes on hangup', () => {
    assert.equal(callSeconds(null, null, 12000), 0);
    assert.equal(callSeconds(10000, null, 12500), 2);
    assert.equal(callSeconds('1970-01-01T00:00:10.000Z', null, 15000), 5);
    assert.equal(callSeconds(10000, '1970-01-01T00:00:14.000Z', 90000), 4);
    assert.equal(callSeconds('invalid', null, 12000), 0);
    assert.equal(callSeconds(20000, null, 12000), 0);
});

await test('camera allocation failure preserves a live mandatory microphone', async () => {
    const mic = track('audio');
    let requests = [];
    const media = await acquireCallMedia(true, {
        getUserMedia: async (constraints) => {
            requests.push(constraints);
            if (constraints.video)
                throw new Error('Failed to allocate videosource');
            return stream(mic);
        },
    });
    assert.deepEqual(requests, [
        { audio: true, video: false },
        { audio: false, video: true },
    ]);
    assert.equal(media.getAudioTracks()[0], mic);
    assert.equal(mic.readyState, 'live');
    assert.equal(media.getVideoTracks().length, 0);
});
await test('voice-only calls never request a camera', async () => {
    const media = await acquireCallMedia(false, {
        getUserMedia: async (constraints) => {
            assert.equal(constraints.video, false);
            return stream(track('audio'));
        },
    });
    assert.equal(media.getAudioTracks().length, 1);
});
await test('successful video attaches camera to the existing audio stream', async () => {
    const mic = track('audio'),
        camera = track('video');
    const media = await acquireCallMedia(true, {
        getUserMedia: async (c) => (c.video ? stream(camera) : stream(mic)),
    });
    assert.deepEqual(media.getTracks(), [mic, camera]);
});
await test('microphone denial fails the call before requesting video', async () => {
    let requests = 0;
    await assert.rejects(
        acquireCallMedia(true, {
            getUserMedia: async () => {
                requests++;
                throw new Error('Permission denied');
            },
        }),
        /microphone.*permission.*required/,
    );
    assert.equal(requests, 1);
});
await test('an empty microphone stream cannot become a silent video-only call', async () => {
    const stray = track('video');
    await assert.rejects(
        acquireCallMedia(true, { getUserMedia: async () => stream(stray) }),
        /working microphone is required/,
    );
    assert.equal(stray.readyState, 'ended');
});
await test('cancelling during camera startup immediately stops audio and late video', async () => {
    const mic = track('audio'),
        camera = track('video'),
        controller = new AbortController();
    await assert.rejects(
        acquireCallMedia(
            true,
            {
                getUserMedia: async (c) => {
                    if (!c.video) return stream(mic);
                    controller.abort();
                    assert.equal(mic.readyState, 'ended');
                    return stream(camera);
                },
            },
            controller.signal,
        ),
        /Call ended/,
    );
    assert.equal(camera.readyState, 'ended');
});

await test('hang-up stops all capture and detaches events before closing the peer', () => {
    const mic = track('audio'),
        camera = track('video');
    const peer = {
        ontrack: () => {},
        onicecandidate: () => {},
        onconnectionstatechange: () => {},
        close() {
            assert.equal(this.ontrack, null);
            assert.equal(this.onicecandidate, null);
            assert.equal(this.onconnectionstatechange, null);
            assert.equal(mic.readyState, 'ended');
            assert.equal(camera.readyState, 'ended');
        },
    };
    releaseCallMedia(peer, stream(mic, camera));
});
await test('hang-up cleanup also handles calls still waiting for devices', () => {
    assert.doesNotThrow(() => releaseCallMedia(null, null));
});
