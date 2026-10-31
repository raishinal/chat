import { useEffect, useRef, useState } from 'react';

/** A short, locally synthesized chime; no remote media or audio permissions needed. */
export function useNotificationSound() {
    const [enabled, setEnabledState] = useState(
        () => localStorage.getItem('relay-message-sounds') !== 'no',
    );
    const [status, setStatus] = useState<'ready' | 'blocked' | 'unsupported'>(
        () =>
            typeof window.AudioContext === 'undefined'
                ? 'unsupported'
                : 'blocked',
    );
    const context = useRef<AudioContext | null>(null);
    const lastPlayed = useRef(-Infinity);

    async function unlock(): Promise<AudioContext | null> {
        if (typeof window.AudioContext === 'undefined') {
            setStatus('unsupported');
            return null;
        }
        try {
            if (!context.current || context.current.state === 'closed')
                context.current = new AudioContext();
            const audio = context.current;
            if (audio.state === 'suspended') await audio.resume();
            setStatus(audio.state === 'running' ? 'ready' : 'blocked');
            return audio.state === 'running' ? audio : null;
        } catch {
            setStatus('blocked');
            return null;
        }
    }

    function play(preview = false) {
        if (!enabled) return;
        const audio = context.current;
        if (!audio || audio.state !== 'running') {
            if (status !== 'unsupported') setStatus('blocked');
            return;
        }
        // Coalesce bursts; notification IDs are already deduplicated by the messenger.
        const now = performance.now();
        if (!preview && now - lastPlayed.current < 2000) return;
        lastPlayed.current = now;
        for (const [index, frequency] of [784, 1046].entries()) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            const start = audio.currentTime + index * 0.14;
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.035, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.onended = () => {
                oscillator.disconnect();
                gain.disconnect();
            };
            oscillator.start(start);
            oscillator.stop(start + 0.24);
        }
    }

    useEffect(() => {
        const onInteraction = () => {
            if (enabled) void unlock();
        };
        document.addEventListener('pointerdown', onInteraction);
        document.addEventListener('keydown', onInteraction);
        return () => {
            document.removeEventListener('pointerdown', onInteraction);
            document.removeEventListener('keydown', onInteraction);
        };
    }, [enabled]);
    useEffect(
        () => () => {
            const audio = context.current;
            context.current = null;
            if (audio && audio.state !== 'closed')
                void audio.close().catch(() => {});
        },
        [],
    );

    function setEnabled(value: boolean) {
        setEnabledState(value);
        localStorage.setItem('relay-message-sounds', value ? 'yes' : 'no');
        if (value) void unlock();
    }
    async function testSound() {
        if (await unlock()) play(true);
    }
    return { enabled, setEnabled, play, testSound, status };
}
