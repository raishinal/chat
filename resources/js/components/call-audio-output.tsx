import { useEffect, useRef, useState, type RefObject } from 'react';
import {
    callAudioOutputs,
    setCallAudioOutput,
    type CallAudioOutput,
} from '@/lib/call-audio-output';

type OutputMediaDevices = MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

export function CallAudioOutput({
    audioRef,
    mediaReady,
}: {
    audioRef: RefObject<HTMLAudioElement | null>;
    mediaReady: boolean;
}) {
    const [outputs, setOutputs] = useState<CallAudioOutput[]>([]);
    const [selected, setSelected] = useState('');
    const [supported, setSupported] = useState(false);
    const [canChoose, setCanChoose] = useState(false);
    const [changing, setChanging] = useState(false);
    const [error, setError] = useState('');
    const busy = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        const devices = navigator.mediaDevices as
            | OutputMediaDevices
            | undefined;
        const supported = typeof audioRef.current?.setSinkId === 'function';
        setSupported(supported);
        setCanChoose(typeof devices?.selectAudioOutput === 'function');
        let disposed = false;
        const refresh = async () => {
            if (!supported || !devices?.enumerateDevices) return;
            try {
                const available = callAudioOutputs(
                    await devices.enumerateDevices(),
                );
                if (disposed) return;
                setOutputs(available);
                const audio = audioRef.current;
                if (
                    audio?.sinkId &&
                    audio.sinkId !== 'default' &&
                    !available.some(
                        (output) => output.deviceId === audio.sinkId,
                    )
                ) {
                    await setCallAudioOutput(audio, '');
                    if (!disposed) {
                        setSelected('');
                        setError(
                            'Your speaker disconnected. Using the system default.',
                        );
                    }
                }
            } catch {
                if (!disposed)
                    setError(
                        'Could not refresh speakers. Check your browser permissions.',
                    );
            }
        };
        void refresh();
        devices?.addEventListener('devicechange', refresh);
        return () => {
            disposed = true;
            mounted.current = false;
            devices?.removeEventListener('devicechange', refresh);
        };
    }, [audioRef, mediaReady]);

    async function choose(deviceId?: string) {
        const audio = audioRef.current;
        if (!audio || busy.current) return;
        busy.current = true;
        setChanging(true);
        setError('');
        try {
            const devices = navigator.mediaDevices as OutputMediaDevices;
            let output: MediaDeviceInfo | undefined;
            if (deviceId === undefined) {
                if (!devices.selectAudioOutput) return;
                // Keep this permission prompt inside the user's click gesture.
                output = await devices.selectAudioOutput();
                deviceId = output.deviceId;
            }
            if (deviceId === 'default') deviceId = '';
            if (!mounted.current) return;
            await setCallAudioOutput(audio, deviceId);
            if (!mounted.current) return;
            setSelected(deviceId);
            if (output) {
                const permitted = callAudioOutputs([output]);
                setOutputs((current) => [
                    ...current.filter((item) => item.deviceId !== deviceId),
                    ...permitted,
                ]);
            }
        } catch (error) {
            if (!mounted.current) return;
            const name = error instanceof Error ? error.name : '';
            if (name !== 'AbortError')
                setError(
                    name === 'NotAllowedError'
                        ? 'Speaker access was blocked. Allow it in your browser settings or use the system default.'
                        : 'Could not switch speakers. Check the device connection and try again.',
                );
        } finally {
            busy.current = false;
            if (mounted.current) setChanging(false);
        }
    }

    if (!supported)
        return (
            <p className="relay-call-setting-note">
                Audio output follows your device sound settings in this browser.
            </p>
        );

    return (
        <div className="relay-call-setting">
            <label>
                Audio output
                <select
                    value={selected}
                    disabled={changing}
                    onChange={(event) => void choose(event.target.value)}
                >
                    <option value="">System default</option>
                    {selected &&
                        !outputs.some(
                            (output) => output.deviceId === selected,
                        ) && (
                            <option value={selected} disabled>
                                Disconnected output
                            </option>
                        )}
                    {outputs.map((output) => (
                        <option key={output.deviceId} value={output.deviceId}>
                            {output.label}
                        </option>
                    ))}
                </select>
            </label>
            {canChoose && (
                <button
                    type="button"
                    className="relay-secondary"
                    disabled={changing}
                    onClick={() => void choose()}
                >
                    Choose another output
                </button>
            )}
            {error && (
                <p role="status" className="relay-call-setting-note">
                    {error}
                </p>
            )}
        </div>
    );
}
