import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    callAudioOutputs,
    setCallAudioOutput,
} from '../resources/js/lib/call-audio-output.ts';

test('the speaker list excludes microphones and duplicate system defaults', () => {
    const outputs = callAudioOutputs([
        { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
        { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
        { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
        { kind: 'audiooutput', deviceId: 'headset', label: 'USB headset' },
        { kind: 'audiooutput', deviceId: 'headset', label: 'USB headset' },
        { kind: 'audiooutput', deviceId: 'speakers', label: '' },
    ]);
    assert.deepEqual(outputs, [
        { deviceId: 'headset', label: 'USB headset' },
        { deviceId: 'speakers', label: 'Speaker 2' },
    ]);
});

test('routing changes the remote audio sink and supports returning to the system default', async () => {
    const routes = [];
    const audio = {
        async setSinkId(id) {
            routes.push(id);
        },
    };
    await setCallAudioOutput(audio, 'headset');
    await setCallAudioOutput(audio, '');
    assert.deepEqual(routes, ['headset', '']);
});

test('unavailable outputs and denied permission are surfaced rather than reported as selected', async () => {
    await assert.rejects(
        setCallAudioOutput({}, 'headset'),
        /device sound settings/,
    );
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    await assert.rejects(
        setCallAudioOutput(
            {
                async setSinkId() {
                    throw denied;
                },
            },
            'headset',
        ),
        (error) => error === denied,
    );
});
