/** A microphone is required; camera failures must never prevent an audio call. */
export async function acquireCallMedia(
    wantsVideo: boolean,
    mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
    signal?: AbortSignal,
): Promise<MediaStream> {
    if (signal?.aborted) throw new Error('Call ended.');
    let media: MediaStream;
    try {
        media = await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
        throw new Error(
            'A working microphone and microphone permission are required to join the call. Check your audio input and browser permissions.',
        );
    }
    const stop = () => media.getTracks().forEach((track) => track.stop());
    signal?.addEventListener('abort', stop, { once: true });
    try {
        if (signal?.aborted) throw new Error('Call ended.');
        if (
            !media.getAudioTracks().some((track) => track.readyState === 'live')
        ) {
            throw new Error(
                'A working microphone is required to join the call.',
            );
        }
        if (wantsVideo) {
            try {
                const video = await mediaDevices.getUserMedia({
                    audio: false,
                    video: true,
                });
                if (signal?.aborted) {
                    video.getTracks().forEach((track) => track.stop());
                    throw new Error('Call ended.');
                }
                for (const track of video.getTracks()) {
                    if (track.kind === 'video' && track.readyState === 'live')
                        media.addTrack(track);
                    else track.stop();
                }
            } catch {
                // Missing, busy, denied or failed camera: preserve the required microphone.
                if (signal?.aborted) throw new Error('Call ended.');
            }
        }
        if (
            !media.getAudioTracks().some((track) => track.readyState === 'live')
        ) {
            throw new Error(
                'The microphone disconnected. Reconnect it and retry the call.',
            );
        }
        return media;
    } catch (error) {
        stop();
        throw error;
    } finally {
        signal?.removeEventListener('abort', stop);
    }
}

/** Stop capture and detach callbacks before closing, so teardown cannot signal failure. */
export function releaseCallMedia(
    peer: RTCPeerConnection | null,
    media: MediaStream | null,
): void {
    if (peer) {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
    }
    media?.getTracks().forEach((track) => track.stop());
    peer?.close();
}

/** Keep streamless audio and video tracks together instead of replacing audio. */
export function addRemoteTrack(
    stream: MediaStream,
    track: MediaStreamTrack,
): void {
    if (!stream.getTracks().some((existing) => existing.id === track.id))
        stream.addTrack(track);
}

export function callSeconds(
    start: string | number | null,
    end: string | null,
    now = Date.now(),
): number {
    const from = typeof start === 'string' ? Date.parse(start) : start;
    const to = end ? Date.parse(end) : now;
    return from !== null && Number.isFinite(from) && Number.isFinite(to)
        ? Math.max(0, Math.floor((to - from) / 1000))
        : 0;
}
