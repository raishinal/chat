export type CallVideoQuality = 'performance' | 'high';

export function callVideoConstraints(
    quality: CallVideoQuality,
): MediaTrackConstraints {
    return quality === 'high'
        ? {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30, max: 30 },
          }
        : {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 24, max: 24 },
          };
}

/** A microphone is required; camera failures must never prevent an audio call. */
export async function acquireCallMedia(
    wantsVideo: boolean,
    mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
    signal?: AbortSignal,
    quality: CallVideoQuality = 'performance',
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
                    video: callVideoConstraints(quality),
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
        peer.onicecandidateerror = null;
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

type AudioStat = {
    type: string;
    kind?: string;
    mediaType?: string;
    audioLevel?: number;
    totalAudioEnergy?: number;
    bytesSent?: number;
    bytesReceived?: number;
    packetsSent?: number;
    packetsReceived?: number;
    packetsLost?: number;
    roundTripTime?: number;
};

/** Audio counters only: never expose device names, addresses, SDP or credentials. */
export function summarizeCallAudio(stats: Iterable<AudioStat>) {
    return [...stats]
        .filter((entry) => (entry.kind ?? entry.mediaType) === 'audio')
        .filter((entry) =>
            [
                'media-source',
                'outbound-rtp',
                'inbound-rtp',
                'remote-inbound-rtp',
            ].includes(entry.type),
        )
        .map((entry) => ({
            type: entry.type,
            audioLevel: entry.audioLevel,
            totalAudioEnergy: entry.totalAudioEnergy,
            bytesSent: entry.bytesSent,
            bytesReceived: entry.bytesReceived,
            packetsSent: entry.packetsSent,
            packetsReceived: entry.packetsReceived,
            packetsLost: entry.packetsLost,
            roundTripTime: entry.roundTripTime,
        }));
}

/** Apply the chosen outgoing profile without renegotiating the call. */
export async function tuneCallVideo(
    peer: RTCPeerConnection,
    quality: CallVideoQuality = 'performance',
): Promise<void> {
    await Promise.all(
        peer.getSenders().map(async (sender) => {
            if (sender.track?.kind !== 'video') return;
            try {
                const parameters = sender.getParameters();
                // Do not add encodings: their count is fixed by negotiation.
                if (!parameters.encodings?.length) return;
                parameters.degradationPreference =
                    quality === 'high'
                        ? 'maintain-resolution'
                        : 'maintain-framerate';
                for (const encoding of parameters.encodings) {
                    encoding.maxBitrate =
                        quality === 'high' ? 12_000_000 : 1_000_000;
                    encoding.maxFramerate = quality === 'high' ? 30 : 24;
                    encoding.scaleResolutionDownBy = 1;
                }
                await sender.setParameters(parameters);
            } catch {
                // Unsupported tuning or a peer closing must not interrupt a call.
            }
        }),
    );
}
