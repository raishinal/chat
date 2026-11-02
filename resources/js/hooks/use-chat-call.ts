import { useEffect, useRef, useState } from 'react';
import { api, type Call } from '@/lib/chat-api';
import { store, update, signal as signalRoute } from '@/routes/api/calls';
import { ice } from '@/routes/api';
import {
    acquireCallMedia,
    tuneCallVideo,
    callVideoConstraints,
    type CallVideoQuality,
    releaseCallMedia,
    addRemoteTrack,
    summarizeCallAudio,
} from '@/lib/call-media';
import { createCallRingback } from '@/lib/call-ringback';
import { confirmCallEnd } from '@/lib/call-ending';
import { createCallConnectivityLoader } from '@/lib/call-connectivity';
import { createCallIceSender } from '@/lib/call-ice-sender';
import { retryCallSignal } from '@/lib/call-signal-retry';
import { canApplyAnswer, RemoteDescriptions } from '@/lib/call-negotiation';
export type Signal = {
    call_id: number;
    type: 'offer' | 'answer' | 'ice';
    signal_id: string;
    index: number;
    total: number;
    chunk: string;
};
export function useChatCall(me: number, onError: (s: string) => void) {
    const [call, setCall] = useState<Call | null>(null),
        [local, setLocal] = useState<MediaStream | null>(null),
        [remote, setRemote] = useState<MediaStream | null>(null),
        [muted, setMuted] = useState(false),
        [camera, setCamera] = useState(false),
        [cameraAvailable, setCameraAvailable] = useState(false),
        [ending, setEnding] = useState(false),
        [accepting, setAccepting] = useState(false),
        [starting, setStarting] = useState(false),
        [ringtoneBlocked, setRingtoneBlocked] = useState(false),
        [connectedAt, setConnectedAt] = useState<number | null>(null),
        [endError, setEndError] = useState(''),
        [videoQuality, setVideoQuality] =
            useState<CallVideoQuality>('performance'),
        [changingVideoQuality, setChangingVideoQuality] = useState(false);
    const current = useRef<Call | null>(null),
        pc = useRef<RTCPeerConnection | null>(null),
        stream = useRef<MediaStream | null>(null),
        candidates = useRef<RTCIceCandidateInit[]>([]),
        chunks = useRef(
            new Map<
                string,
                { parts: string[]; total: number; time: number; type: string }
            >(),
        ),
        offered = useRef(false),
        remoteDescriptions = useRef(new RemoteDescriptions()),
        remoteStream = useRef<MediaStream | null>(null),
        signalQueue = useRef(Promise.resolve()),
        connectedReported = useRef(false),
        ringback = useRef<ReturnType<typeof createCallRingback> | null>(null),
        ringtone = useRef<ReturnType<typeof createCallRingback> | null>(null),
        preparing = useRef<Promise<RTCPeerConnection> | null>(null),
        generation = useRef(0),
        quality = useRef<CallVideoQuality>('performance'),
        qualityChange = useRef(false),
        startingCall = useRef(false),
        mediaAbort = useRef<AbortController | null>(null),
        iceSender = useRef<ReturnType<
            typeof createCallIceSender<RTCIceCandidateInit>
        > | null>(null),
        locallyEnded = useRef(new Set<number>()),
        dismissed = useRef(new Set<number>()),
        endingRequests = useRef(new Set<number>()),
        confirmedEnds = useRef(new Set<number>()),
        pendingEnd = useRef<{ id: number; action: string } | null>(null),
        closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connectivityLoader = useRef(
        createCallConnectivityLoader((signal) =>
            api<{ ice_servers: RTCIceServer[] }>(ice(), undefined, signal),
        ),
    );
    function cleanup() {
        iceSender.current?.stop();
        iceSender.current = null;
        connectivityLoader.current.clear();
        ringtone.current?.stop();
        ringback.current?.stop();
        generation.current++;
        mediaAbort.current?.abort();
        mediaAbort.current = null;
        releaseCallMedia(pc.current, stream.current);
        pc.current = null;
        stream.current = null;
        setLocal(null);
        setRemote(null);
        remoteStream.current = null;
        connectedReported.current = false;
        candidates.current = [];
        remoteDescriptions.current.clear();
        chunks.current.clear();
        offered.current = false;
        preparing.current = null;
        setMuted(false);
        setCamera(false);
        setCameraAvailable(false);
    }
    function dismiss() {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        if (current.current) dismissed.current.add(current.current.id);
        cleanup();
        current.current = null;
        setCall(null);
        setEndError('');
    }
    function closeSoon(id: number) {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => {
            if (current.current?.id === id && current.current.ended_at)
                dismiss();
        }, 800);
    }
    async function action(action: string, id = current.current?.id) {
        if (!id) return;
        if (['end', 'cancel', 'reject', 'failed'].includes(action)) {
            if (endingRequests.current.has(id)) return;
            endingRequests.current.add(id);
            locallyEnded.current.add(id);
            pendingEnd.current = { id, action };
            setEndError('');
            setEnding(true);
            if (current.current?.id === id) {
                const terminal = {
                    ...current.current,
                    status:
                        action === 'cancel'
                            ? 'cancelled'
                            : action === 'reject'
                              ? 'rejected'
                              : action === 'failed'
                                ? 'failed'
                                : 'ended',
                    ended_at:
                        current.current.ended_at ?? new Date().toISOString(),
                };
                current.current = terminal;
                setCall(terminal);
            }
            // Capture stops immediately, before waiting for the network.
            cleanup();
            try {
                await confirmCallEnd(
                    async (signal) => {
                        const result = await api<{ data: Call }>(
                            update(id),
                            { action },
                            signal,
                        );
                        receive(result.data);
                    },
                    () => confirmedEnds.current.has(id),
                );
                if (pendingEnd.current?.id === id) pendingEnd.current = null;
                if (current.current?.id === id) closeSoon(id);
            } catch (error) {
                if (confirmedEnds.current.has(id) || current.current?.id !== id)
                    return;
                console.warn('Relay hang-up request failed', {
                    callId: id,
                    status:
                        typeof error === 'object' &&
                        error !== null &&
                        'status' in error
                            ? error.status
                            : null,
                    errorName: error instanceof Error ? error.name : 'Unknown',
                });
                setEndError(
                    'Your microphone and camera are off. Could not confirm hang-up with the server. Retry to notify the other person.',
                );
            } finally {
                endingRequests.current.delete(id);
                if (current.current?.id === id) setEnding(false);
            }
            return;
        }
        if (locallyEnded.current.has(id) || dismissed.current.has(id)) return;
        const result = await api<{ data: Call }>(update(id), { action });
        receive(result.data);
    }
    function receive(next: Call) {
        if (dismissed.current.has(next.id)) return;
        if (locallyEnded.current.has(next.id) && !next.ended_at) return;
        if (
            current.current &&
            current.current.id !== next.id &&
            !current.current.ended_at
        )
            return;
        if (
            current.current?.id === next.id &&
            current.current.ended_at &&
            !next.ended_at
        )
            return;
        if (current.current?.id !== next.id) setConnectedAt(null);
        if (next.status !== 'ringing' || next.ended_at)
            ringback.current?.stop();
        current.current = next;
        setCall(next);
        if (next.ended_at) {
            confirmedEnds.current.add(next.id);
            if (pendingEnd.current?.id === next.id) {
                pendingEnd.current = null;
                setEndError('');
                setEnding(false);
            }
            locallyEnded.current.add(next.id);
            cleanup();
            closeSoon(next.id);
        }
    }
    async function sendDescription(
        id: number,
        description: {
            type: 'offer' | 'answer';
            payload: RTCSessionDescriptionInit;
        },
    ) {
        const signal = mediaAbort.current?.signal;
        if (
            !signal ||
            current.current?.id !== id ||
            locallyEnded.current.has(id)
        )
            throw new Error('Call ended.');
        await retryCallSignal(
            (attemptSignal) => api(signalRoute(id), description, attemptSignal),
            signal,
        );
    }
    async function prepare(
        c: Call,
        connectivity?: { ice_servers: RTCIceServer[] },
    ): Promise<RTCPeerConnection> {
        if (preparing.current) return preparing.current;
        if (pc.current) return pc.current;
        const gen = generation.current;
        const promise = (async () => {
            if (!navigator.mediaDevices?.getUserMedia)
                throw new Error(
                    'Calling requires HTTPS and a browser with media support.',
                );
            // Fetch fresh short-lived connectivity credentials before accessing media.
            const config =
                connectivity ?? (await connectivityLoader.current.load(c.id));
            if (gen !== generation.current) throw new Error('Call ended.');
            // Gather a candidate pool while the microphone and camera start.
            const peer = new RTCPeerConnection({
                iceServers: config.ice_servers,
                iceCandidatePoolSize: 1,
            });
            pc.current = peer;
            peer.ontrack = (e) => {
                if (gen !== generation.current) return;
                remoteStream.current ??= new MediaStream();
                addRemoteTrack(remoteStream.current, e.track);
                // A fresh wrapper also updates the player when another track arrives.
                setRemote(new MediaStream(remoteStream.current.getTracks()));
            };
            const sender = createCallIceSender<RTCIceCandidateInit>(
                (candidate, signal) =>
                    retryCallSignal(
                        (attemptSignal) =>
                            api(
                                signalRoute(c.id),
                                {
                                    type: 'ice',
                                    payload: candidate,
                                },
                                attemptSignal,
                            ),
                        signal,
                    ),
                (error) => {
                    if (
                        gen === generation.current &&
                        !locallyEnded.current.has(c.id)
                    )
                        onError((error as Error).message);
                },
            );
            iceSender.current = sender;
            peer.onicecandidate = (e) => {
                if (e.candidate && gen === generation.current)
                    void sender.enqueue(e.candidate.toJSON());
            };
            // Report connectivity failures without logging SDP, addresses or credentials.
            const iceErrors: number[] = [];
            peer.onicecandidateerror = (event) => {
                if (gen !== generation.current) return;
                if (!iceErrors.includes(event.errorCode))
                    iceErrors.push(event.errorCode);
            };
            let failureReported = false;
            const reportConnectionFailure = async () => {
                const localTypes = new Set<string>();
                const remoteTypes = new Set<string>();
                const pairStates = new Set<string>();
                try {
                    const stats = await peer.getStats();
                    stats.forEach((entry) => {
                        if (entry.type === 'local-candidate')
                            localTypes.add(entry.candidateType);
                        if (entry.type === 'remote-candidate')
                            remoteTypes.add(entry.candidateType);
                        if (entry.type === 'candidate-pair')
                            pairStates.add(entry.state);
                    });
                } catch {
                    // State information is still useful if statistics are unavailable.
                }
                if (
                    gen !== generation.current ||
                    locallyEnded.current.has(c.id)
                )
                    return;
                console.error('Relay call connectivity diagnostic', {
                    callId: c.id,
                    connectionState: peer.connectionState,
                    iceConnectionState: peer.iceConnectionState,
                    iceGatheringState: peer.iceGatheringState,
                    signalingState: peer.signalingState,
                    localDescriptionType: peer.localDescription?.type ?? null,
                    remoteDescriptionType: peer.remoteDescription?.type ?? null,
                    localCandidateTypes: [...localTypes],
                    remoteCandidateTypes: [...remoteTypes],
                    candidatePairStates: [...pairStates],
                    iceErrorCodes: iceErrors,
                });
                onError(
                    'Call audio could not connect. Check both networks and the Cloudflare TURN configuration, then redial.',
                );
                void action('failed', c.id).catch((e) => onError(e.message));
            };
            const connectionChanged = () => {
                if (
                    gen !== generation.current ||
                    locallyEnded.current.has(c.id)
                )
                    return;
                if (
                    peer.connectionState === 'connected' ||
                    ['connected', 'completed'].includes(peer.iceConnectionState)
                ) {
                    setConnectedAt((previous) => previous ?? Date.now());
                    ringback.current?.stop();
                    if (!connectedReported.current) {
                        connectedReported.current = true;
                        void action('connected', c.id).catch((e) => {
                            connectedReported.current = false;
                            if (!locallyEnded.current.has(c.id))
                                onError(e.message);
                        });
                    }
                }
                if (
                    !failureReported &&
                    (peer.connectionState === 'failed' ||
                        peer.iceConnectionState === 'failed')
                ) {
                    failureReported = true;
                    void reportConnectionFailure();
                }
                if (peer.connectionState === 'disconnected')
                    onError(
                        'Call connection interrupted. Attempting to recover; the call expires if connectivity does not return.',
                    );
            };
            peer.onconnectionstatechange = connectionChanged;
            peer.oniceconnectionstatechange = connectionChanged;
            mediaAbort.current = new AbortController();
            const media = await acquireCallMedia(
                c.kind === 'video',
                navigator.mediaDevices,
                mediaAbort.current.signal,
                quality.current,
            );
            if (gen !== generation.current) {
                media.getTracks().forEach((t) => t.stop());
                throw new Error('Call ended.');
            }
            stream.current = media;
            setLocal(media);
            const hasCamera = media
                .getVideoTracks()
                .some((track) => track.readyState === 'live');
            setCameraAvailable(hasCamera);
            setCamera(hasCamera);
            media.getTracks().forEach((t) => peer.addTrack(t, media));
            if (c.kind === 'video' && !hasCamera)
                peer.addTransceiver('video', { direction: 'recvonly' });
            return peer;
        })();
        preparing.current = promise;
        try {
            return await promise;
        } finally {
            if (preparing.current === promise) preparing.current = null;
        }
    }
    async function start(conversation: number, kind: 'audio' | 'video') {
        if (
            startingCall.current ||
            (current.current && !current.current.ended_at)
        )
            return;
        startingCall.current = true;
        setStarting(true);
        ringback.current ??= createCallRingback();
        void ringback.current.unlock();
        setConnectedAt(null);
        let startedId: number | null = null;
        setEndError('');
        try {
            const connectivity = await api<{ ice_servers: RTCIceServer[] }>(
                ice(),
            );
            const res = await api<{ data: Call }>(store(conversation), {
                kind,
            });
            startedId = res.data.id;
            receive(res.data);
            await prepare(res.data, connectivity);
        } catch (e) {
            if (startedId && locallyEnded.current.has(startedId)) return;
            onError((e as Error).message);
            if (current.current && !current.current.ended_at)
                await action('failed').catch(() => cleanup());
            else cleanup();
        } finally {
            startingCall.current = false;
            setStarting(false);
        }
    }
    useEffect(() => {
        if (
            call?.status === 'ringing' &&
            call.callee_id === me &&
            !call.ended_at
        ) {
            // Start only the network request while ringing, never microphone capture.
            void connectivityLoader.current.load(call.id).catch(() => {
                // A failed prefetch is retried and reported if the user accepts.
            });
        }
    }, [call?.id, call?.status, call?.ended_at, me]);
    async function accept() {
        ringtone.current?.stop();
        const incoming = current.current;
        if (!incoming || incoming.ended_at || accepting) return;
        setAccepting(true);
        setConnectedAt(null);
        try {
            await prepare(incoming);
            if (
                locallyEnded.current.has(incoming.id) ||
                current.current?.id !== incoming.id
            )
                return;
            await action('accept', incoming.id);
        } catch (e) {
            if (locallyEnded.current.has(incoming.id)) return;
            onError((e as Error).message);
            await action('failed', incoming.id);
        } finally {
            setAccepting(false);
        }
    }
    function handleSignal(s: Signal) {
        const queuedGeneration = generation.current;
        signalQueue.current = signalQueue.current.then(async () => {
            if (queuedGeneration === generation.current) await processSignal(s);
        });
        return signalQueue.current;
    }
    async function processSignal(s: Signal) {
        if (s.call_id !== current.current?.id || current.current.ended_at)
            return;
        try {
            const now = Date.now();
            for (const [key, value] of chunks.current)
                if (now - value.time > 30000) chunks.current.delete(key);
            let group = chunks.current.get(s.signal_id);
            if (!group) {
                group = { parts: [], total: s.total, time: now, type: s.type };
                chunks.current.set(s.signal_id, group);
            }
            group.parts[s.index] = s.chunk;
            if (group.parts.filter(Boolean).length !== s.total) return;
            chunks.current.delete(s.signal_id);
            const raw = Uint8Array.from(atob(group.parts.join('')), (c) =>
                c.charCodeAt(0),
            );
            const payload = JSON.parse(new TextDecoder().decode(raw));
            const peer = await prepare(current.current!);
            if (s.type === 'ice') {
                if (peer.remoteDescription) await peer.addIceCandidate(payload);
                else candidates.current.push(payload);
                return;
            }
            // Recovery resends answers. A second answer must not fail an
            // already negotiated call, even if its SDP includes more ICE.
            if (s.type === 'answer' && !canApplyAnswer(peer.signalingState))
                return;
            const duplicate = remoteDescriptions.current.classify(payload);
            if (duplicate !== 'new') {
                if (
                    duplicate === 'repeat' &&
                    s.type === 'offer' &&
                    peer.localDescription?.type === 'answer'
                ) {
                    await sendDescription(s.call_id, {
                        type: 'answer',
                        payload: {
                            type: 'answer',
                            sdp: peer.localDescription.sdp,
                        },
                    });
                }
                return;
            }
            await peer.setRemoteDescription(payload);
            remoteDescriptions.current.remember(payload);
            for (const candidate of candidates.current)
                await peer.addIceCandidate(candidate);
            candidates.current = [];
            if (s.type === 'offer') {
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                void tuneCallVideo(peer, quality.current);
                await sendDescription(s.call_id, {
                    type: 'answer',
                    payload: { type: answer.type, sdp: answer.sdp },
                });
            }
        } catch (e) {
            if (locallyEnded.current.has(s.call_id)) return;
            onError((e as Error).message);
            void action('failed', s.call_id);
        }
    }
    useEffect(() => {
        const unlock = () => {
            ringtone.current ??= createCallRingback(undefined, true);
            void ringtone.current
                .unlock()
                .then((ready) => setRingtoneBlocked(!ready));
        };
        document.addEventListener('pointerdown', unlock);
        document.addEventListener('keydown', unlock);
        return () => {
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('keydown', unlock);
        };
    }, []);
    useEffect(() => {
        if (
            call?.status !== 'ringing' ||
            call.callee_id !== me ||
            call.ended_at ||
            accepting
        ) {
            ringtone.current?.stop();
            return;
        }
        let active = true;
        ringtone.current ??= createCallRingback(undefined, true);
        ringtone.current.start();
        setRingtoneBlocked(!ringtone.current.isReady());
        void ringtone.current.unlock().then((ready) => {
            if (active) setRingtoneBlocked(!ready);
        });
        return () => {
            active = false;
            ringtone.current?.stop();
        };
    }, [call?.id, call?.status, call?.ended_at, me, accepting]);
    useEffect(() => {
        if (
            call?.status === 'ringing' &&
            call.caller_id === me &&
            !call.ended_at
        )
            ringback.current?.start();
        else ringback.current?.stop();
    }, [call?.id, call?.status, call?.ended_at, me]);
    useEffect(() => {
        if (
            call?.status === 'accepted' &&
            call.caller_id === me &&
            !offered.current
        ) {
            offered.current = true;
            void (async () => {
                try {
                    const peer = await prepare(call);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    void tuneCallVideo(peer, quality.current);
                    await sendDescription(call.id, {
                        type: 'offer',
                        payload: { type: offer.type, sdp: offer.sdp },
                    });
                } catch (e) {
                    if (locallyEnded.current.has(call.id)) return;
                    onError((e as Error).message);
                    void action('failed', call.id);
                }
            })();
        }
    }, [call?.status]);
    useEffect(() => {
        if (!call || call.ended_at) return;
        const timer = window.setInterval(() => {
            const c = current.current;
            if (c && !c.ended_at && Date.parse(c.expires_at) < Date.now())
                void action('failed').catch(() => {
                    receive({
                        ...c,
                        status: 'failed',
                        ended_at: new Date().toISOString(),
                    });
                });
            else if (c && ['accepted', 'connected'].includes(c.status))
                void action(
                    connectedAt && !c.connected_at ? 'connected' : 'heartbeat',
                ).catch((e) => {
                    if (!locallyEnded.current.has(c.id))
                        onError((e as Error).message);
                });
        }, 20000);
        return () => clearInterval(timer);
    }, [call?.id, call?.ended_at, connectedAt]);
    useEffect(() => {
        if (!connectedAt || !call || call.ended_at) return;
        const peer = pc.current;
        const gen = generation.current;
        if (!peer) return;
        let samples = 0;
        const timer = window.setInterval(() => {
            if (++samples >= 3) window.clearInterval(timer);
            void peer
                .getStats()
                .then((stats) => {
                    if (gen !== generation.current) return;
                    console.info('Relay call audio diagnostic', {
                        callId: call.id,
                        microphone: stream.current
                            ?.getAudioTracks()
                            .map((track) => ({
                                enabled: track.enabled,
                                muted: track.muted,
                                readyState: track.readyState,
                            })),
                        audio: summarizeCallAudio(stats.values()),
                    });
                })
                .catch(() => {
                    // Closing a peer during the sample must not create a call error.
                });
        }, 5000);
        return () => window.clearInterval(timer);
    }, [connectedAt, call?.id, call?.ended_at]);
    useEffect(
        () => () => {
            generation.current++;
            iceSender.current?.stop();
            mediaAbort.current?.abort();
            connectivityLoader.current.clear();
            ringback.current?.dispose();
            ringtone.current?.dispose();
            if (closeTimer.current) clearTimeout(closeTimer.current);
            releaseCallMedia(pc.current, stream.current);
        },
        [],
    );
    async function changeVideoQuality(next: CallVideoQuality) {
        if (qualityChange.current || next === quality.current) return;
        qualityChange.current = true;
        setChangingVideoQuality(true);
        const gen = generation.current;
        try {
            const track = stream.current?.getVideoTracks()[0];
            if (track?.readyState === 'live') {
                await track.applyConstraints(callVideoConstraints(next));
                if (gen !== generation.current) return;
                if (pc.current) await tuneCallVideo(pc.current, next);
            }
            if (gen !== generation.current) return;
            quality.current = next;
            setVideoQuality(next);
        } catch {
            if (gen === generation.current)
                onError(
                    'Could not switch video quality. Your camera may not support this setting.',
                );
        } finally {
            qualityChange.current = false;
            setChangingVideoQuality(false);
        }
    }
    return {
        call,
        local,
        remote,
        muted,
        camera,
        cameraAvailable,
        videoQuality,
        changingVideoQuality,
        changeVideoQuality,
        ending,
        accepting,
        starting,
        ringtoneBlocked,
        enableRingtone: async () => {
            ringtone.current ??= createCallRingback(undefined, true);
            const ready = await ringtone.current.unlock();
            setRingtoneBlocked(!ready);
            if (
                ready &&
                current.current?.status === 'ringing' &&
                current.current.callee_id === me
            ) {
                ringtone.current.stop();
                ringtone.current.start();
            }
        },
        connectedAt,
        endError,
        retryEnd: () => {
            const pending = pendingEnd.current;
            if (pending) void action(pending.action, pending.id);
        },
        start,
        accept,
        action,
        receive,
        handleSignal,
        dismiss,
        toggleMute: () => {
            stream.current
                ?.getAudioTracks()
                .forEach((t) => (t.enabled = muted));
            setMuted(!muted);
        },
        toggleCamera: () => {
            if (!cameraAvailable) return;
            stream.current
                ?.getVideoTracks()
                .forEach((t) => (t.enabled = !camera));
            setCamera(!camera);
        },
    };
}
