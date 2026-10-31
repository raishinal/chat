/** Local ringback: two seconds of tone, four seconds of silence. */
export function createCallRingback(
    factory = () => new AudioContext(),
    incoming = false,
) {
    let context: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let nodes: OscillatorNode[] = [];
    let ringing = false;
    async function unlock(): Promise<boolean> {
        try {
            context ??= factory();
            if (context.state === 'suspended') await context.resume();
            return context.state === 'running';
        } catch {
            /* Calling still works when audio synthesis is unavailable. */
            return false;
        }
    }
    function pulse() {
        if (!ringing || !context || context.state !== 'running') return;
        const audio = context;
        for (const offset of incoming ? [0, 0.65] : [0]) {
            for (const frequency of incoming ? [660, 880] : [440, 480]) {
                const oscillator = audio.createOscillator();
                const gain = audio.createGain();
                const start = audio.currentTime + offset;
                const duration = incoming ? 0.45 : 2;
                const volume = incoming ? 0.18 : 0.07;
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(volume, start + 0.02);
                gain.gain.setValueAtTime(volume, start + duration - 0.05);
                gain.gain.linearRampToValueAtTime(0, start + duration);
                oscillator.connect(gain);
                gain.connect(audio.destination);
                oscillator.onended = () => {
                    nodes = nodes.filter((node) => node !== oscillator);
                    oscillator.disconnect();
                    gain.disconnect();
                };
                nodes.push(oscillator);
                oscillator.start(start);
                oscillator.stop(start + duration);
            }
        }
    }
    function stop() {
        ringing = false;
        if (timer) clearInterval(timer);
        timer = null;
        for (const node of nodes) {
            node.stop();
            node.disconnect();
        }
        nodes = [];
    }
    function start() {
        if (ringing) return;
        ringing = true;
        void unlock().then((ready) => {
            if (ready && ringing && !nodes.length) pulse();
        });
        pulse();
        timer = setInterval(pulse, incoming ? 3000 : 6000);
    }
    function dispose() {
        stop();
        if (context) void context.close().catch(() => {});
        context = null;
    }
    return {
        unlock,
        start,
        stop,
        dispose,
        isReady: () => context?.state === 'running',
    };
}
