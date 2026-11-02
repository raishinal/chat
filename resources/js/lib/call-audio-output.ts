export type CallAudioOutput = { deviceId: string; label: string };

/** Only list speakers; never confuse a microphone with an output device. */
export function callAudioOutputs(
    devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[],
): CallAudioOutput[] {
    const outputs = new Map<string, CallAudioOutput>();
    for (const device of devices) {
        if (
            device.kind !== 'audiooutput' ||
            !device.deviceId ||
            device.deviceId === 'default'
        )
            continue;
        outputs.set(device.deviceId, {
            deviceId: device.deviceId,
            label: device.label || `Speaker ${outputs.size + 1}`,
        });
    }
    return [...outputs.values()];
}

export async function setCallAudioOutput(
    audio: Pick<HTMLAudioElement, 'setSinkId'>,
    deviceId: string,
): Promise<void> {
    if (typeof audio.setSinkId !== 'function')
        throw new Error('Choose your speaker in your device sound settings.');
    await audio.setSinkId(deviceId);
}
