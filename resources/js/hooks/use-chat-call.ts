import { useEffect, useRef, useState } from 'react';
import { api, type Call } from '@/lib/chat-api';
import { store, update, signal as signalRoute } from '@/routes/api/calls';
import { ice } from '@/routes/api';
import {
    acquireCallMedia,
    releaseCallMedia,
    addRemoteTrack,
} from '@/lib/call-media';
import { createCallRingback } from '@/lib/call-ringback';
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
        [ringtoneBlocked, setRingtoneBlocked] = useState(false),
        [connectedAt, setConnectedAt] = useState<number | null>(null),
        [endError, setEndError] = useState('');
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
        remoteStream = useRef<MediaStream | null>(null),
        signalQueue = useRef(Promise.resolve()),
        connectedReported = useRef(false),
        ringback = useRef<ReturnType<typeof createCallRingback> | null>(null),
        ringtone = useRef<ReturnType<typeof createCallRingback> | null>(null),
        preparing = useRef<Promise<RTCPeerConnection> | null>(null),
        generation = useRef(0),
        mediaAbort = useRef<AbortController | null>(null),
        locallyEnded = useRef(new Set<number>()),
        dismissed = useRef(new Set<number>()),
        endingRequests = useRef(new Set<number>()),
        pendingEnd = useRef<{ id: number; action: string } | null>(null),
        closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function cleanup() {
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
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const result = await api<{ data: Call }>(
                    update(id),
                    { action },
                    controller.signal,
                );
                receive(result.data);
                pendingEnd.current = null;
                closeSoon(id);
            } catch {
                setEndError(
                    'Your microphone and camera are off. Could not confirm hang-up with the server. Retry to notify the other person.',
                );
            } finally {
                clearTimeout(timeout);
                endingRequests.current.delete(id);
                setEnding(false);
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
            locallyEnded.current.add(next.id);
            cleanup();
            if (!endingRequests.current.has(next.id)) closeSoon(next.id);
        }
    }
    async function prepare(
        c: Call,
        connectivity?: { ice_servers: RTCIceServer[] },
    ): Promise<RTCPeerConnection> {
        if (pc.current) return pc.current;
        if (preparing.current) return preparing.current;
        const gen = generation.current;
        const promise = (async () => {
            if (!navigator.mediaDevices?.getUserMedia)
                throw new Error(
                    'Calling requires HTTPS and a browser with media support.',
                );
            // Fetch fresh short-lived connectivity credentials before accessing media.
            const config =
                connectivity ??
                (await api<{ ice_servers: RTCIceServer[] }>(ice()));
            if (gen !== generation.current) throw new Error('Call ended.');
            mediaAbort.current = new AbortController();
            const media = await acquireCallMedia(
                c.kind === 'video',
                navigator.mediaDevices,
                mediaAbort.current.signal,
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
            const peer = new RTCPeerConnection({
                iceServers: config.ice_servers,
            });
            pc.current = peer;
            media.getTracks().forEach((t) => peer.addTrack(t, media));
            if (c.kind === 'video' && !hasCamera)
                peer.addTransceiver('video', { direction: 'recvonly' });
            peer.ontrack = (e) => {
                if (gen !== generation.current) return;
                remoteStream.current ??= new MediaStream();
                addRemoteTrack(remoteStream.current, e.track);
                // A fresh wrapper also updates the player when another track arrives.
                setRemote(new MediaStream(remoteStream.current.getTracks()));
            };
            peer.onicecandidate = (e) => {
                if (e.candidate)
                    void api(signalRoute(c.id), {
                        type: 'ice',
                        payload: e.candidate.toJSON(),
                    }).catch((e) => {
                        if (!locallyEnded.current.has(c.id)) onError(e.message);
                    });
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
                    peer.connectionState === 'failed' ||
                    peer.iceConnectionState === 'failed'
                ) {
                    onError(
                        'Call audio could not connect. Check both networks and the Cloudflare TURN configuration, then redial.',
                    );
                    void action('failed', c.id).catch((e) =>
                        onError(e.message),
                    );
                }
                if (peer.connectionState === 'disconnected')
                    onError(
                        'Call connection interrupted. Attempting to recover; the call expires if connectivity does not return.',
                    );
            };
            peer.onconnectionstatechange = connectionChanged;
            peer.oniceconnectionstatechange = connectionChanged;
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
        }
    }
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
            await peer.setRemoteDescription(payload);
            for (const candidate of candidates.current)
                await peer.addIceCandidate(candidate);
            candidates.current = [];
            if (s.type === 'offer') {
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                await api(signalRoute(s.call_id), {
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
                    await api(signalRoute(call.id), {
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
    useEffect(
        () => () => {
            generation.current++;
            mediaAbort.current?.abort();
            ringback.current?.dispose();
            ringtone.current?.dispose();
            if (closeTimer.current) clearTimeout(closeTimer.current);
            releaseCallMedia(pc.current, stream.current);
        },
        [],
    );
    return {
        call,
        local,
        remote,
        muted,
        camera,
        cameraAvailable,
        ending,
        accepting,
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
