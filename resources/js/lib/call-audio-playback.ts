/** Reattempt remote playback when media arrives or a user gesture permits audio. */
export function bindCallAudioPlayback(
    audio: HTMLAudioElement,
    stream: MediaStream,
    onBlocked: (blocked: boolean) => void,
    gestures: EventTarget = document,
) {
    let disposed = false;
    let pending = false;
    audio.srcObject = stream;
    audio.muted = false;
    const tracks = stream.getAudioTracks();
    const play = () => {
        if (disposed || pending || !tracks.length) return;
        pending = true;
        void audio.play().then(
            () => {
                pending = false;
                if (!disposed) onBlocked(false);
            },
            () => {
                pending = false;
                if (!disposed) onBlocked(true);
            },
        );
    };
    const recover = () => {
        if (audio.paused) play();
    };
    const paused = () => {
        if (!disposed && tracks.length) onBlocked(true);
    };
    audio.addEventListener('pause', paused);
    audio.addEventListener('loadedmetadata', play);
    tracks.forEach((track) => track.addEventListener('unmute', play));
    gestures.addEventListener('pointerdown', recover);
    gestures.addEventListener('keydown', recover);
    gestures.addEventListener('visibilitychange', recover);
    play();

    return () => {
        disposed = true;
        audio.removeEventListener('pause', paused);
        audio.removeEventListener('loadedmetadata', play);
        tracks.forEach((track) => track.removeEventListener('unmute', play));
        gestures.removeEventListener('pointerdown', recover);
        gestures.removeEventListener('keydown', recover);
        gestures.removeEventListener('visibilitychange', recover);
        audio.pause();
        audio.srcObject = null;
    };
}
