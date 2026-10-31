import { useEffect, useRef, useState } from 'react';
import { api, type Call } from '@/lib/chat-api';
import { store, update, signal as signalRoute } from '@/routes/api/calls';
import { ice } from '@/routes/api';
import { acquireCallMedia, releaseCallMedia } from '@/lib/call-media';
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
        preparing = useRef<Promise<RTCPeerConnection> | null>(null),
        generation = useRef(0),
        mediaAbort = useRef<AbortController | null>(null),
        locallyEnded = useRef(new Set<number>()),
        dismissed = useRef(new Set<number>()),
        endingRequests = useRef(new Set<number>()),
        pendingEnd = useRef<{ id: number; action: string } | null>(null),
        closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function cleanup() {
        generation.current++;
        mediaAbort.current?.abort();
        mediaAbort.current = null;
        releaseCallMedia(pc.current, stream.current);
        pc.current = null;
        stream.current = null;
        setLocal(null);
        setRemote(null);
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
            peer.ontrack = (e) =>
                setRemote(e.streams[0] ?? new MediaStream([e.track]));
            peer.onicecandidate = (e) => {
                if (e.candidate)
                    void api(signalRoute(c.id), {
                        type: 'ice',
                        payload: e.candidate.toJSON(),
                    }).catch((e) => {
                        if (!locallyEnded.current.has(c.id)) onError(e.message);
                    });
            };
            peer.onconnectionstatechange = () => {
                if (peer.connectionState === 'connected')
                    void action('connected', c.id).catch((e) =>
                        onError(e.message),
                    );
                if (peer.connectionState === 'failed')
                    void action('failed', c.id).catch((e) =>
                        onError(e.message),
                    );
                if (peer.connectionState === 'disconnected')
                    onError(
                        'Call connection interrupted. Attempting to recover; the call expires if connectivity does not return.',
                    );
            };
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
        const incoming = current.current;
        if (!incoming || incoming.ended_at || accepting) return;
        setAccepting(true);
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
    async function handleSignal(s: Signal) {
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
                void action('heartbeat').catch((e) => {
                    if (!locallyEnded.current.has(c.id))
                        onError((e as Error).message);
                });
        }, 20000);
        return () => clearInterval(timer);
    }, [call?.id, call?.ended_at]);
    useEffect(
        () => () => {
            generation.current++;
            mediaAbort.current?.abort();
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
