import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindCallAudioPlayback } from '../resources/js/lib/call-audio-playback.ts';

function fixture(play) {
    const audio = Object.assign(new EventTarget(), {
        paused: true,
        muted: true,
        srcObject: null,
        play,
        pause() {
            this.paused = true;
        },
    });
    const track = new EventTarget();
    const stream = { getAudioTracks: () => [track] };
    return { audio, track, stream, gestures: new EventTarget() };
}

test('blocked incoming audio resumes on a user gesture and a remote unmute', async () => {
    let attempts = 0;
    const blocked = [];
    const { audio, track, stream, gestures } = fixture(async () => {
        attempts++;
        if (attempts === 1) throw new Error('Autoplay blocked');
    });
    const dispose = bindCallAudioPlayback(
        audio,
        stream,
        (value) => blocked.push(value),
        gestures,
    );
    await Promise.resolve();
    assert.equal(audio.muted, false);
    assert.equal(blocked.at(-1), true);
    gestures.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    assert.equal(blocked.at(-1), false);
    track.dispatchEvent(new Event('unmute'));
    await Promise.resolve();
    assert.equal(attempts, 3);
    audio.dispatchEvent(new Event('pause'));
    assert.equal(blocked.at(-1), true);
    dispose();
    gestures.dispatchEvent(new Event('pointerdown'));
    track.dispatchEvent(new Event('unmute'));
    assert.equal(attempts, 3);
    assert.equal(audio.srcObject, null);
});

test('late playback rejection after hang-up cannot change the next call UI', async () => {
    let reject;
    const { audio, stream, gestures } = fixture(
        () =>
            new Promise((_, fail) => {
                reject = fail;
            }),
    );
    const dispose = bindCallAudioPlayback(audio, stream, assert.fail, gestures);
    dispose();
    reject(new Error('Call ended'));
    await Promise.resolve();
});
