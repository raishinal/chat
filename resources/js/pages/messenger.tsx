import { Head, Link, usePage } from '@inertiajs/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import {
    ArrowLeft,
    ArrowUpRight,
    Bell,
    Check,
    CheckCheck,
    Download,
    File,
    LoaderCircle,
    LogOut,
    MessageCircle,
    Mic,
    MicOff,
    Paperclip,
    Phone,
    PhoneOff,
    Plus,
    Search,
    Send,
    Settings,
    Shield,
    Video,
    VideoOff,
    X,
} from 'lucide-react';
import {
    api,
    ApiError,
    upload,
    csrfHeaders,
    type Person,
    type Conversation,
    type Message,
    type Attachment,
    type Notice,
    type Call,
    type Page,
} from '@/lib/chat-api';
import { useChatCall, type Signal } from '@/hooks/use-chat-call';
import { callSeconds } from '@/lib/call-media';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { me, users as usersRoute } from '@/routes/api';
import * as conversationsRoute from '@/routes/api/conversations';
import * as messagesRoute from '@/routes/api/messages';
import * as attachmentsRoute from '@/routes/api/attachments';
import * as noticesRoute from '@/routes/api/notifications';
import * as callsRoute from '@/routes/api/calls';
import * as broadcastRoute from '@/routes/api/broadcast';
import * as profileRoute from '@/routes/api/profile';
import { logout, login } from '@/routes';
import {
    createRealtimeRecovery,
    realtimeConnectionIssue,
    type RealtimeRecovery,
} from '@/lib/realtime-recovery';
import AdminPanel from '@/components/chat/admin-panel';
import ChangePassword from '@/components/chat/change-password';
import MessageContent from '@/components/chat/message-content';
import '../../css/messenger.css';
type Envelope<T> = { data: T };
function subscriptionFailure(error: unknown, channel: string): string {
    const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number'
            ? error.status
            : 0;
    const reason =
        status === 401
            ? 'Your session is not authenticated. Sign out and sign in again.'
            : status === 419
              ? 'CSRF verification failed. Reload and sign in again.'
              : status === 403
                ? 'The server denied channel authorization.'
                : status === 429
                  ? 'Too many authorization requests. Wait a minute and retry.'
                  : status === 503
                    ? 'Restart the Laravel server and queue worker to load the Pusher configuration.'
                    : status === 200
                      ? 'The server returned an invalid authorization response. Restart the Laravel server.'
                      : status
                        ? 'The authorization request failed.'
                        : 'The authorization service could not be reached.';
    return `${channel} subscription failed${status ? ` (HTTP ${status})` : ''}. ${reason}`;
}
function Avatar({ person }: { person: Person }) {
    return (
        <span className="relay-avatar">
            {person.avatar_url ? (
                <img src={person.avatar_url} alt="" />
            ) : (
                person.name
                    .split(' ')
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join('')
            )}
            <i className={person.online ? 'online' : ''} />
        </span>
    );
}
function Media({
    stream,
    muted = false,
}: {
    stream: MediaStream | null;
    muted?: boolean;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [audioBlocked, setAudioBlocked] = useState(false);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = stream;
        const audio = audioRef.current;
        let disposed = false;
        if (audio && !muted) {
            audio.srcObject = stream;
            if (stream?.getAudioTracks().length)
                void audio
                    .play()
                    .then(() => {
                        if (!disposed) setAudioBlocked(false);
                    })
                    .catch(() => {
                        if (!disposed) setAudioBlocked(true);
                    });
        }
        return () => {
            disposed = true;
            if (audio) {
                audio.pause();
                audio.srcObject = null;
            }
        };
    }, [stream, muted]);
    return (
        <>
            <video ref={ref} autoPlay playsInline muted />
            {!muted && <audio ref={audioRef} autoPlay />}
            {!muted && audioBlocked && (
                <button
                    className="relay-secondary"
                    onClick={() => {
                        void audioRef.current
                            ?.play()
                            .then(() => setAudioBlocked(false))
                            .catch(() => setAudioBlocked(true));
                    }}
                >
                    Enable call audio
                </button>
            )}
        </>
    );
}
function FilePreview({
    attachment: a,
    onOpen,
}: {
    attachment: Attachment;
    onOpen: (a: Attachment) => void;
}) {
    const [failed, setFailed] = useState(false);
    return (
        <div className="relay-file">
            {a.previewable && !failed && a.mime.startsWith('image/') ? (
                <button onClick={() => onOpen(a)} aria-label={'View ' + a.name}>
                    <img
                        loading="lazy"
                        src={a.thumbnail_url || a.url}
                        alt={a.name}
                        onError={() => setFailed(true)}
                    />
                </button>
            ) : a.previewable && !failed && a.mime.startsWith('video/') ? (
                <>
                    <video
                        src={a.url}
                        controls
                        preload="metadata"
                        onError={() => setFailed(true)}
                    />
                    <button onClick={() => onOpen(a)}>
                        View full size <ArrowUpRight size={13} />
                    </button>
                </>
            ) : a.previewable && !failed && a.mime.startsWith('audio/') ? (
                <audio src={a.url} controls onError={() => setFailed(true)} />
            ) : (
                <File size={24} />
            )}
            <div>
                <strong>{a.name}</strong>
                <small>
                    {a.mime} · {(a.size / 1024).toFixed(1)} KB
                    {failed ? ' · Preview unavailable' : ''}
                </small>
            </div>
            <a href={a.download_url} aria-label={'Download ' + a.name}>
                <Download size={17} />
            </a>
        </div>
    );
}
export default function Messenger() {
    const initial = usePage().props.auth.user as unknown as Person;
    const [self, setSelf] = useState(initial),
        [conversations, setConversations] = useState<Conversation[]>([]),
        [selected, setSelected] = useState<Conversation | null>(null),
        [messages, setMessages] = useState<Message[]>([]),
        [cursor, setCursor] = useState<string | null>(null),
        [conversationPage, setConversationPage] = useState<string | null>(null),
        [noticeCursor, setNoticeCursor] = useState<string | null>(null),
        [notices, setNotices] = useState<Notice[]>([]),
        [query, setQuery] = useState(''),
        [draft, setDraft] = useState(''),
        [files, setFiles] = useState<File[]>([]),
        [progress, setProgress] = useState<number | null>(null),
        [error, setError] = useState(''),
        [liveError, setLiveError] = useState(''),
        [sessionExpired, setSessionExpired] = useState(false),
        [loading, setLoading] = useState(false),
        [panel, setPanel] = useState<
            'new' | 'notifications' | 'profile' | 'admin' | null
        >(null),
        [people, setPeople] = useState<Person[]>([]),
        [peopleQuery, setPeopleQuery] = useState(''),
        [peopleNext, setPeopleNext] = useState<string | null>(null),
        [connection, setConnection] = useState('Connecting'),
        [online, setOnline] = useState(navigator.onLine),
        [typing, setTyping] = useState(false),
        [viewer, setViewer] = useState<Attachment | null>(null),
        [name, setName] = useState(initial.name),
        [avatar, setAvatar] = useState<File | null>(null),
        [browserAlerts, setBrowserAlerts] = useState(
            localStorage.getItem('relay-alerts') === 'yes',
        ),
        [previewAlerts, setPreviewAlerts] = useState(
            localStorage.getItem('relay-previews') === 'yes',
        ),
        [callHistory, setCallHistory] = useState<Call[]>([]),
        [seconds, setSeconds] = useState(0);
    const selectedRef = useRef<Conversation | null>(null),
        uploadAbort = useRef<AbortController | null>(null),
        echoRef = useRef<Echo<'pusher'> | null>(null),
        pusherRef = useRef<Pusher | null>(null),
        recoveryRef = useRef<RealtimeRecovery | null>(null),
        refreshInFlight = useRef<Promise<void> | null>(null),
        authExpired = useRef(false),
        handlers = useRef({
            message: (_m: Message) => {},
            refresh: () => {},
            notice: (_n: Notice) => {},
            call: (_c: Call) => {},
            signal: (_s: Signal) => {},
        }),
        typingAt = useRef(0),
        sentTypingAt = useRef(0),
        bottom = useRef<HTMLDivElement>(null),
        requestVersion = useRef(0),
        latestServerId = useRef(0),
        oldestServerId = useRef(0),
        seenNotices = useRef(new Set<number>()),
        noticesInitialized = useRef(false);
    const call = useChatCall(self.id, setError);
    const viewport = useRef<HTMLElement>(null);
    const historyContent = useRef<HTMLDivElement>(null);
    const followLatest = useRef(true);
    const initialBottom = useRef(true);
    const olderInFlight = useRef(false);
    const scrollAnchor = useRef<{
        id: number;
        height: number;
        top: number;
    } | null>(null);
    const [olderLoading, setOlderLoading] = useState(false);
    const messageSound = useNotificationSound();
    useEffect(() => {
        latestServerId.current = Math.max(
            0,
            ...messages.filter((m) => !m.pending && !m.failed).map((m) => m.id),
        );
    }, [messages]);
    function expireSession() {
        authExpired.current = true;
        setSessionExpired(true);
        setConnection('Session expired');
        setLiveError(
            'Your session expired or this account is no longer active. Sign in again to continue.',
        );
        pusherRef.current?.disconnect();
        call.dismiss();
    }
    function recoverLive() {
        if (
            !navigator.onLine ||
            document.visibilityState !== 'visible' ||
            authExpired.current
        )
            return;
        if (recoveryRef.current) void recoveryRef.current.resume();
        else handlers.current.refresh();
    }
    function fail(e: unknown) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 419)) {
            expireSession();
            return;
        }
        setError((e as Error).message);
    }
    async function refreshConversations() {
        const result = await api<Page<Conversation>>(
            conversationsRoute.index({ query: { q: query } }),
        );
        setConversations(result.data);
        setConversationPage(result.links?.next ?? null);
    }
    async function refreshNotices() {
        const result = await api<Page<Notice>>(noticesRoute.index());
        // Silence initial history only. Later API refreshes may arrive before their
        // live event; marking those IDs seen here would incorrectly swallow alerts.
        if (!noticesInitialized.current) {
            result.data.forEach((n) => seenNotices.current.add(n.id));
            noticesInitialized.current = true;
        }
        setNotices(result.data);
        setNoticeCursor(result.next_cursor ?? null);
    }
    async function read(c: Conversation, list: Message[]) {
        if (document.visibilityState !== 'visible') return;
        const latest = list.filter((m) => !m.pending && !m.failed).at(-1);
        if (latest && latest.id > c.read_id) {
            await api(conversationsRoute.read(c.id), { message_id: latest.id });
            selectedRef.current =
                selectedRef.current?.id === c.id
                    ? { ...selectedRef.current, read_id: latest.id }
                    : selectedRef.current;
            setConversations((all) =>
                all.map((row) =>
                    row.id === c.id
                        ? { ...row, unread_count: 0, read_id: latest.id }
                        : row,
                ),
            );
        }
    }
    async function open(c: Conversation) {
        followLatest.current = true;
        initialBottom.current = true;
        scrollAnchor.current = null;
        olderInFlight.current = false;
        setOlderLoading(false);
        selectedRef.current = c;
        setSelected(c);
        latestServerId.current = 0;
        setMessages([]);
        setCursor(null);
        setTyping(false);
        setLoading(true);
        setDraft('');
        setFiles([]);
        const version = ++requestVersion.current;
        try {
            const result = await api<Page<Message>>(messagesRoute.index(c.id));
            if (version !== requestVersion.current) return;
            const list = [...result.data].reverse();
            setMessages(list);
            setCursor(result.meta?.next_cursor ?? null);
            await read(c, list);
        } catch (e) {
            fail(e);
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }
    oldestServerId.current = Math.min(
        ...messages.filter((m) => !m.pending && !m.failed).map((m) => m.id),
    );
    async function reconcile() {
        await Promise.all([refreshConversations(), refreshNotices()]);
        const c = selectedRef.current;
        if (c) {
            const [result, updated] = await Promise.all([
                api<Page<Message>>(
                    messagesRoute.index(c.id, {
                        query: {
                            after_id: Number.isFinite(oldestServerId.current)
                                ? Math.max(0, oldestServerId.current - 1)
                                : undefined,
                        },
                    }),
                ),
                api<Envelope<Conversation>>(conversationsRoute.show(c.id)),
            ]);
            if (selectedRef.current?.id !== c.id) return;
            const list = [...result.data];
            let next = result.links?.next;
            while (next && latestServerId.current > 0) {
                const page = await api<Page<Message>>(next);
                if (selectedRef.current?.id !== c.id) return;
                list.push(...page.data);
                next = page.links?.next;
            }
            list.sort((a, b) => a.id - b.id);
            setViewer((current) =>
                current &&
                !list.some((m) =>
                    m.attachments.some((a) => a.id === current.id),
                )
                    ? null
                    : current,
            );
            setSelected(updated.data);
            selectedRef.current = updated.data;
            setMessages((old) => {
                const all = new Map(old.map((m) => [m.client_id, m]));
                list.forEach((m) => all.set(m.client_id, m));
                return [...all.values()].sort((a, b) => a.id - b.id);
            });
            await read(updated.data, list);
        }
        const history = await api<Page<Call>>(callsRoute.index());
        setCallHistory(history.data);
        const active = history.data.find((c) => !c.ended_at);
        if (active) call.receive(active);
        else if (call.call && !call.call.ended_at) {
            const ended = history.data.find((c) => c.id === call.call?.id);
            if (ended) call.receive(ended);
        }
    }
    handlers.current = {
        refresh: () => {
            if (authExpired.current || refreshInFlight.current) return;
            refreshInFlight.current = reconcile()
                .catch(fail)
                .finally(() => {
                    refreshInFlight.current = null;
                });
        },
        message: (m) => {
            if (m.conversation_id !== selectedRef.current?.id) return;
            if (!m.attachments) {
                void reconcile().catch(fail);
                return;
            }
            setMessages((old) =>
                [...old.filter((row) => row.client_id !== m.client_id), m].sort(
                    (a, b) => a.id - b.id,
                ),
            );
            void read(selectedRef.current, [m]).catch(fail);
        },
        notice: (n) => {
            if (seenNotices.current.has(n.id)) return;
            seenNotices.current.add(n.id);
            setNotices((old) => [n, ...old.filter((row) => row.id !== n.id)]);
            if (
                n.data.conversation_id === selectedRef.current?.id &&
                document.visibilityState === 'visible' &&
                document.hasFocus()
            )
                return;
            if (n.kind !== 'incoming_call') messageSound.play();
            if (
                browserAlerts &&
                'Notification' in window &&
                Notification.permission === 'granted'
            )
                new Notification(
                    n.kind === 'message'
                        ? 'New private message'
                        : 'Call notification',
                    {
                        body: previewAlerts
                            ? `${n.data.sender_name ?? 'Someone'} sent a ${n.kind.replaceAll('_', ' ')}`
                            : 'Open Relay to view.',
                        tag: `relay-${n.id}`,
                    },
                );
        },
        call: call.receive,
        signal: (s) => {
            void call.handleSignal(s);
        },
    };
    useEffect(() => {
        void api<Envelope<Person>>(me())
            .then((r) => setSelf(r.data))
            .catch(fail);
        void reconcile().catch(fail);
        const key = import.meta.env.VITE_PUSHER_APP_KEY;
        if (!key) {
            setConnection('Live service not configured');
            return;
        }
        const pusher = new Pusher(key, {
            cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER || 'ap2',
            channelAuthorization: {
                endpoint: broadcastRoute.auth.url(),
                transport: 'ajax',
                headersProvider: () => ({
                    Accept: 'application/json',
                    ...csrfHeaders(),
                }),
            },
            userAuthentication: {
                endpoint: broadcastRoute.user.url(),
                transport: 'ajax',
                headersProvider: () => ({
                    Accept: 'application/json',
                    ...csrfHeaders(),
                }),
            },
        });
        pusher.signin();
        const echo = new Echo({ broadcaster: 'pusher', client: pusher });
        echoRef.current = echo;
        pusherRef.current = pusher;
        const recovery = createRealtimeRecovery({
            client: pusher,
            getSession: async () => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                try {
                    return (
                        await api<Envelope<Person>>(
                            me(),
                            undefined,
                            controller.signal,
                        )
                    ).data;
                } finally {
                    clearTimeout(timeout);
                }
            },
            onSession: (session) => {
                setSelf(session);
                if (
                    pusher.connection.state === 'connected' &&
                    pusher.allChannels().every((channel) => channel.subscribed)
                ) {
                    setLiveError((previous) =>
                        previous.includes('subscription failed') ||
                        previous.startsWith('Your session')
                            ? previous
                            : '',
                    );
                }
            },
            onExpired: expireSession,
            onReconnect: () => {
                setConnection('Reconnecting');
                setLiveError('Reconnecting to live updates…');
            },
            onIssue: setLiveError,
            onRefresh: () => handlers.current.refresh(),
        });
        recoveryRef.current = recovery;
        pusher.connection.bind('state_change', (state: { current: string }) => {
            if (authExpired.current) return;
            setConnection(state.current);
            if (state.current === 'connected') {
                setLiveError((previous) =>
                    previous.includes('subscription failed') ||
                    previous.startsWith('Your session')
                        ? previous
                        : '',
                );
                handlers.current.refresh();
            }
        });
        pusher.connection.bind('error', (event: unknown) => {
            if (!authExpired.current)
                setLiveError(realtimeConnectionIssue(event));
        });
        echo.private(`v1.users.${self.id}`)
            .listen(
                '.v1.conversation.deleted',
                (event: Envelope<{ conversation_id: number }>) => {
                    const id = event.data.conversation_id;
                    setConversations((old) =>
                        old.filter((conversation) => conversation.id !== id),
                    );
                    if (selectedRef.current?.id === id) {
                        requestVersion.current++;
                        selectedRef.current = null;
                        setSelected(null);
                        setMessages([]);
                        setCursor(null);
                    }
                },
            )
            .subscribed(() =>
                setLiveError((previous) =>
                    previous.startsWith('Private user channel') ? '' : previous,
                ),
            )
            .listen('.v1.conversation.updated', () =>
                handlers.current.refresh(),
            )
            .listen('.v1.notification.created', (event: Envelope<Notice>) =>
                handlers.current.notice(event.data),
            )
            .listen('.v1.call.updated', (event: Envelope<Call>) =>
                handlers.current.call(event.data),
            )
            .listen('.v1.call.signal', (event: Envelope<Signal>) =>
                handlers.current.signal(event.data),
            )
            .error((error: unknown) =>
                setLiveError(
                    subscriptionFailure(error, 'Private user channel'),
                ),
            );
        echo.join('v1.presence')
            .here(() => {})
            .joining(() => handlers.current.refresh())
            .leaving(() => handlers.current.refresh());
        return () => {
            recovery.dispose();
            recoveryRef.current = null;
            pusherRef.current = null;
            echo.disconnect();
            echoRef.current = null;
        };
    }, []);
    useEffect(() => {
        if (!selected || !echoRef.current) return;
        const echo = echoRef.current;
        echo.private(`v1.conversations.${selected.id}`)
            .subscribed(() =>
                setLiveError((previous) =>
                    previous.startsWith('Conversation subscription')
                        ? ''
                        : previous,
                ),
            )
            .listen('.v1.message.created', (e: Envelope<Message>) =>
                handlers.current.message(e.data),
            )
            .listen('.v1.message.updated', () => handlers.current.refresh())
            .listen('.v1.message.read', () => handlers.current.refresh())
            .listen('.v1.typing', (e: Envelope<{ user_id: number }>) => {
                if (e.data.user_id !== self.id) {
                    setTyping(true);
                    typingAt.current = Date.now();
                }
            })
            .error((error: unknown) =>
                setLiveError(subscriptionFailure(error, 'Conversation')),
            );
        return () => echo.leave(`v1.conversations.${selected.id}`);
    }, [selected?.id]);
    useEffect(() => {
        const timer = setTimeout(() => {
            void refreshConversations().catch(fail);
        }, 250);
        return () => clearTimeout(timer);
    }, [query]);
    useEffect(() => {
        const controller = new AbortController();
        if (panel !== 'new') return;
        const timer = setTimeout(
            () =>
                void api<Page<Person>>(
                    usersRoute({ query: { q: peopleQuery } }),
                    undefined,
                    controller.signal,
                )
                    .then((r) => {
                        setPeople(r.data);
                        setPeopleNext(r.links?.next ?? null);
                    })
                    .catch((e) => {
                        if (e.name !== 'AbortError') fail(e);
                    }),
            250,
        );
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [peopleQuery, panel]);
    useEffect(() => {
        const onOnline = () => {
                setOnline(true);
                recoverLive();
            },
            onOffline = () => setOnline(false),
            onVisible = () => {
                if (document.visibilityState === 'visible') recoverLive();
            };
        window.addEventListener('focus', recoverLive);
        window.addEventListener('pageshow', recoverLive);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible' && navigator.onLine)
                recoverLive();
        }, 30000);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', recoverLive);
            window.removeEventListener('pageshow', recoverLive);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            document.removeEventListener('visibilitychange', onVisible);
            uploadAbort.current?.abort();
        };
    }, []);
    useLayoutEffect(() => {
        const view = viewport.current;
        if (!view || loading) return;
        const anchor = scrollAnchor.current;
        if (anchor && anchor.id === selectedRef.current?.id) {
            view.scrollTop = anchor.top + view.scrollHeight - anchor.height;
            scrollAnchor.current = null;
        } else if (initialBottom.current || followLatest.current) {
            view.scrollTop = view.scrollHeight;
            initialBottom.current = false;
        }
    }, [messages, loading, typing]);
    useEffect(() => {
        const content = historyContent.current;
        if (!content) return;
        const observer = new ResizeObserver(() => {
            if (
                followLatest.current &&
                !scrollAnchor.current &&
                viewport.current
            )
                viewport.current.scrollTop = viewport.current.scrollHeight;
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, [selected?.id, loading]);
    useEffect(() => {
        const timer = setInterval(() => {
            setSeconds(
                callSeconds(
                    call.call?.connected_at ?? call.connectedAt,
                    call.call?.ended_at ?? null,
                ),
            );
            if (Date.now() - typingAt.current > 8000) setTyping(false);
        }, 1000);
        return () => clearInterval(timer);
    }, [call.call?.connected_at, call.connectedAt, call.call?.ended_at]);
    async function send(existing?: Message) {
        const c = selectedRef.current;
        if (!c || progress !== null) return;
        const clientId = existing?.client_id ?? crypto.randomUUID();
        let attachments = existing?.attachments ?? [];
        setError('');
        try {
            if (!existing && files.length) {
                const controller = new AbortController();
                uploadAbort.current = controller;
                setProgress(0);
                const result = await upload<Page<Attachment>>(
                    attachmentsRoute.store(c.id),
                    files,
                    setProgress,
                    controller.signal,
                );
                attachments = result.data;
                setProgress(null);
            }
            const pending: Message = existing ?? {
                id: Date.now(),
                client_id: clientId,
                conversation_id: c.id,
                sender_id: self.id,
                body: draft || null,
                attachments,
                created_at: new Date().toISOString(),
            };
            if (!existing) {
                followLatest.current = true;
                setMessages((old) => [...old, { ...pending, pending: true }]);
                setDraft('');
                setFiles([]);
            } else
                setMessages((old) =>
                    old.map((m) =>
                        m.client_id === clientId
                            ? { ...m, pending: true, failed: false }
                            : m,
                    ),
                );
            try {
                const result = await api<Envelope<Message>>(
                    messagesRoute.store(c.id),
                    {
                        client_id: clientId,
                        body: pending.body,
                        attachment_ids: attachments.map((a) => a.id),
                    },
                );
                if (selectedRef.current?.id === c.id)
                    setMessages((old) =>
                        [
                            ...old.filter((m) => m.client_id !== clientId),
                            result.data,
                        ].sort((a, b) => a.id - b.id),
                    );
                await refreshConversations();
            } catch (e) {
                if (selectedRef.current?.id === c.id)
                    setMessages((old) =>
                        old.map((m) =>
                            m.client_id === clientId
                                ? { ...m, pending: false, failed: true }
                                : m,
                        ),
                    );
                throw e;
            }
        } catch (e) {
            fail(e);
        } finally {
            setProgress(null);
        }
    }
    async function newConversation(person: Person) {
        try {
            const result = await api<Envelope<Conversation>>(
                conversationsRoute.store(),
                { user_id: person.id },
            );
            setPanel(null);
            await refreshConversations();
            await open(result.data);
        } catch (e) {
            fail(e);
        }
    }
    async function loadOlder() {
        if (!selected || !cursor || loading || olderInFlight.current) return;
        const id = selected.id;
        const version = requestVersion.current;
        olderInFlight.current = true;
        setOlderLoading(true);
        try {
            const result = await api<Page<Message>>(
                messagesRoute.index(id, { query: { cursor } }),
            );
            if (
                selectedRef.current?.id !== id ||
                requestVersion.current !== version
            )
                return;
            const view = viewport.current;
            if (view)
                scrollAnchor.current = {
                    id,
                    height: view.scrollHeight,
                    top: view.scrollTop,
                };
            followLatest.current = false;
            setMessages((old) => {
                const map = new Map(old.map((m) => [m.client_id, m]));
                result.data.forEach((m) => map.set(m.client_id, m));
                return [...map.values()].sort((a, b) => a.id - b.id);
            });
            setCursor(result.meta?.next_cursor ?? null);
        } catch (e) {
            if (requestVersion.current === version) fail(e);
        } finally {
            if (requestVersion.current === version) {
                olderInFlight.current = false;
                setOlderLoading(false);
            }
        }
    }
    useEffect(() => {
        if (!panel && !viewer && !call.call) return;
        const previous = document.activeElement as HTMLElement | null;
        const onKey = (event: KeyboardEvent) => {
            const dialogs = document.querySelectorAll<HTMLElement>(
                '.relay [role="dialog"]',
            );
            const dialog = dialogs[dialogs.length - 1];
            if (!dialog) return;
            if (event.key === 'Escape' && !call.call) {
                setViewer(null);
                setPanel(null);
            }
            if (event.key === 'Tab') {
                const focusable = Array.from(
                    dialog.querySelectorAll<HTMLElement>(
                        'button:not(:disabled),a[href],input,select,textarea,video[controls],audio[controls]',
                    ),
                ).filter((el) => !el.hasAttribute('hidden'));
                const first = focusable[0],
                    last = focusable.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus();
        };
    }, [panel, viewer, call.call?.id]);
    const activeCall = call.call && !call.call.ended_at;

    return (
        <>
            <Head title="Relay · Private messages" />
            <div className="relay">
                <nav className="relay-rail">
                    <a className="relay-brand" href="#" aria-label="Relay home">
                        r<span>•</span>
                    </a>
                    <button
                        className="active"
                        aria-label="Messages"
                        onClick={() => setPanel(null)}
                    >
                        <MessageCircle />
                    </button>
                    <button
                        aria-label="Notifications"
                        onClick={() => setPanel('notifications')}
                    >
                        <Bell />
                        {notices.some((n) => !n.read_at) && <i />}
                    </button>
                    {self.role === 'admin' && (
                        <button
                            aria-label="Administration"
                            onClick={() => setPanel('admin')}
                        >
                            <Shield />
                        </button>
                    )}
                    <div className="rail-spacer" />
                    <button
                        aria-label="Profile settings"
                        onClick={() => setPanel('profile')}
                    >
                        <Settings />
                    </button>
                    <Link href={logout()} as="button" aria-label="Log out">
                        <LogOut />
                    </Link>
                    <Avatar person={self} />
                </nav>
                <aside
                    className={
                        'relay-sidebar ' + (selected ? 'mobile-hide' : '')
                    }
                >
                    <header>
                        <div>
                            <small>YOUR PRIVATE WORKSPACE</small>
                            <h1>
                                Messages <span>{conversations.length}</span>
                            </h1>
                        </div>
                        <button
                            className="relay-icon"
                            aria-label="New conversation"
                            onClick={() => setPanel('new')}
                        >
                            <Plus />
                        </button>
                    </header>
                    <label className="relay-search">
                        <Search size={17} />
                        <input
                            placeholder="Search conversations"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Search conversations"
                        />
                    </label>
                    <div className="relay-list-title">
                        ALL CONVERSATIONS <span>↘</span>
                    </div>
                    <div className="relay-conversations">
                        {conversations.map((c) => (
                            <button
                                key={c.id}
                                className={
                                    'relay-conversation ' +
                                    (selected?.id === c.id ? 'selected' : '')
                                }
                                onClick={() => void open(c)}
                            >
                                <Avatar person={c.peer} />
                                <div>
                                    <strong>{c.peer.name}</strong>
                                    <p>
                                        {(c.latest_message?.deleted_at
                                            ? 'Message deleted'
                                            : c.latest_message?.body) ||
                                            (c.latest_message?.attachments
                                                .length
                                                ? 'Sent an attachment'
                                                : 'Say hello to start the conversation')}
                                    </p>
                                </div>
                                <aside>
                                    <time>
                                        {new Date(
                                            c.updated_at,
                                        ).toLocaleDateString(undefined, {
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                    </time>
                                    {c.unread_count > 0 && (
                                        <b>{c.unread_count}</b>
                                    )}
                                </aside>
                            </button>
                        ))}
                        {!conversations.length && (
                            <p className="relay-muted p-6">
                                {query
                                    ? 'No conversations match your search.'
                                    : 'Your conversations will appear here. Start a private conversation with your team.'}
                            </p>
                        )}
                        {conversationPage && (
                            <button
                                className="relay-secondary"
                                onClick={() =>
                                    void api<Page<Conversation>>(
                                        conversationPage,
                                    )
                                        .then((r) => {
                                            setConversations((old) => [
                                                ...old,
                                                ...r.data.filter(
                                                    (c) =>
                                                        !old.some(
                                                            (x) =>
                                                                x.id === c.id,
                                                        ),
                                                ),
                                            ]);
                                            setConversationPage(
                                                r.links?.next ?? null,
                                            );
                                        })
                                        .catch(fail)
                                }
                            >
                                More conversations
                            </button>
                        )}
                    </div>
                    <footer>
                        <Shield size={15} />
                        <div>
                            Private by design
                            <small>
                                Only conversation members have access.
                            </small>
                        </div>
                    </footer>
                </aside>
                <main
                    className={'relay-main ' + (!selected ? 'mobile-hide' : '')}
                >
                    <div className="relay-connection" role="status">
                        <span
                            className={
                                online && connection === 'connected'
                                    ? 'connected'
                                    : ''
                            }
                        />
                        {sessionExpired
                            ? 'Session expired · sign in to reconnect'
                            : !online
                              ? 'Offline · retry messages when you reconnect'
                              : connection === 'connected'
                                ? 'Live connection secure'
                                : connection === 'Live service not configured'
                                  ? 'Live service not configured · API sync every 30 seconds'
                                  : `${connection} · API sync available`}
                        {sessionExpired ? (
                            <Link href={login()}>Sign in</Link>
                        ) : (
                            <button onClick={recoverLive}>Refresh</button>
                        )}
                    </div>
                    {liveError && (
                        <div className="relay-live-notice" role="status">
                            {liveError}
                            {!sessionExpired && (
                                <button onClick={recoverLive}>
                                    Retry connection
                                </button>
                            )}
                        </div>
                    )}
                    {error && (
                        <div role="alert" className="relay-error">
                            {error}
                            <button
                                onClick={() => setError('')}
                                aria-label="Dismiss error"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}
                    {selected ? (
                        <>
                            <header className="relay-chat-header">
                                <button
                                    className="relay-icon mobile-back"
                                    aria-label="Back to conversations"
                                    onClick={() => {
                                        selectedRef.current = null;
                                        setSelected(null);
                                        requestVersion.current++;
                                    }}
                                >
                                    <ArrowLeft />
                                </button>
                                <Avatar person={selected.peer} />
                                <div>
                                    <h2>{selected.peer.name}</h2>
                                    <p>
                                        {typing
                                            ? 'Typing…'
                                            : selected.peer.online
                                              ? 'Online now'
                                              : selected.peer.last_seen_at
                                                ? 'Last seen ' +
                                                  new Date(
                                                      selected.peer
                                                          .last_seen_at,
                                                  ).toLocaleString()
                                                : 'Available for a conversation'}
                                    </p>
                                </div>
                                <div className="header-actions">
                                    <button
                                        className="relay-icon"
                                        title={
                                            connection !== 'connected'
                                                ? 'A live connection is required'
                                                : 'Start audio call'
                                        }
                                        disabled={
                                            !!activeCall ||
                                            connection !== 'connected' ||
                                            !online
                                        }
                                        onClick={() =>
                                            void call.start(
                                                selected.id,
                                                'audio',
                                            )
                                        }
                                        aria-label="Start audio call"
                                    >
                                        <Phone />
                                    </button>
                                    <button
                                        className="relay-icon"
                                        title={
                                            connection !== 'connected'
                                                ? 'A live connection is required'
                                                : 'Start video call'
                                        }
                                        disabled={
                                            !!activeCall ||
                                            connection !== 'connected' ||
                                            !online
                                        }
                                        onClick={() =>
                                            void call.start(
                                                selected.id,
                                                'video',
                                            )
                                        }
                                        aria-label="Start video call"
                                    >
                                        <Video />
                                    </button>
                                </div>
                            </header>
                            <section
                                ref={viewport}
                                onScroll={(event) => {
                                    const view = event.currentTarget;
                                    followLatest.current =
                                        view.scrollHeight -
                                            view.clientHeight -
                                            view.scrollTop <
                                        80;
                                    if (
                                        !initialBottom.current &&
                                        view.scrollTop < 120
                                    )
                                        void loadOlder();
                                }}
                                className="relay-history"
                                aria-label="Message history"
                            >
                                <div ref={historyContent}>
                                    {cursor && (
                                        <button
                                            className="relay-secondary mx-auto"
                                            onClick={() => void loadOlder()}
                                            disabled={olderLoading}
                                        >
                                            {olderLoading
                                                ? 'Loading earlier messages…'
                                                : 'Scroll up for earlier messages · Retry'}
                                        </button>
                                    )}
                                    {loading ? (
                                        <div className="relay-empty">
                                            <LoaderCircle className="animate-spin" />
                                            Loading conversation…
                                        </div>
                                    ) : !messages.length ? (
                                        <div className="relay-empty">
                                            <MessageCircle size={42} />
                                            <h2>
                                                The start of something good.
                                            </h2>
                                            <p>
                                                Send{' '}
                                                {
                                                    selected.peer.name.split(
                                                        ' ',
                                                    )[0]
                                                }{' '}
                                                a message. This conversation is
                                                just between you two.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="relay-date">
                                                YOUR PRIVATE CONVERSATION
                                            </div>
                                            {messages.map((m) => (
                                                <article
                                                    className={
                                                        'relay-message ' +
                                                        (m.sender_id === self.id
                                                            ? 'mine'
                                                            : '')
                                                    }
                                                    key={m.client_id}
                                                >
                                                    <div className="relay-bubble">
                                                        <MessageContent
                                                            message={m}
                                                            own={
                                                                m.sender_id ===
                                                                self.id
                                                            }
                                                            renderAttachment={(
                                                                a,
                                                            ) => (
                                                                <FilePreview
                                                                    attachment={
                                                                        a
                                                                    }
                                                                    onOpen={
                                                                        setViewer
                                                                    }
                                                                />
                                                            )}
                                                            onChange={(
                                                                updated,
                                                            ) => {
                                                                if (
                                                                    selectedRef
                                                                        .current
                                                                        ?.id !==
                                                                    updated.conversation_id
                                                                )
                                                                    return;
                                                                setMessages(
                                                                    (old) =>
                                                                        old.map(
                                                                            (
                                                                                row,
                                                                            ) =>
                                                                                row.id ===
                                                                                updated.id
                                                                                    ? updated
                                                                                    : row,
                                                                        ),
                                                                );
                                                                setViewer(
                                                                    (
                                                                        current,
                                                                    ) =>
                                                                        current &&
                                                                        !updated.attachments.some(
                                                                            (
                                                                                a,
                                                                            ) =>
                                                                                a.id ===
                                                                                current.id,
                                                                        ) &&
                                                                        m.attachments.some(
                                                                            (
                                                                                a,
                                                                            ) =>
                                                                                a.id ===
                                                                                current.id,
                                                                        )
                                                                            ? null
                                                                            : current,
                                                                );
                                                                void refreshConversations().catch(
                                                                    fail,
                                                                );
                                                            }}
                                                        />
                                                    </div>
                                                    <small>
                                                        {new Date(
                                                            m.created_at,
                                                        ).toLocaleTimeString(
                                                            undefined,
                                                            {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            },
                                                        )}
                                                        {m.sender_id ===
                                                            self.id &&
                                                            (m.failed ? (
                                                                <button
                                                                    onClick={() =>
                                                                        void send(
                                                                            m,
                                                                        )
                                                                    }
                                                                >
                                                                    Failed ·
                                                                    Retry
                                                                </button>
                                                            ) : m.pending ? (
                                                                <span>
                                                                    Sending…
                                                                </span>
                                                            ) : m.id <=
                                                              selected.peer_read_id ? (
                                                                <span>
                                                                    <CheckCheck
                                                                        size={
                                                                            13
                                                                        }
                                                                    />
                                                                    Read
                                                                </span>
                                                            ) : (
                                                                <span>
                                                                    <Check
                                                                        size={
                                                                            13
                                                                        }
                                                                    />
                                                                    Sent
                                                                </span>
                                                            ))}
                                                    </small>
                                                </article>
                                            ))}
                                        </>
                                    )}
                                    {typing && (
                                        <p className="relay-muted">
                                            {selected.peer.name} is typing…
                                        </p>
                                    )}
                                    <div ref={bottom} />
                                </div>
                            </section>
                            <form
                                className="relay-composer"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void send();
                                }}
                            >
                                {files.length > 0 && (
                                    <div className="relay-selected-files">
                                        {files.map((f, i) => (
                                            <span key={`${f.name}-${i}`}>
                                                {f.name} (
                                                {(f.size / 1024).toFixed(0)} KB)
                                                <button
                                                    type="button"
                                                    disabled={progress !== null}
                                                    onClick={() =>
                                                        setFiles((old) =>
                                                            old.filter(
                                                                (_, n) =>
                                                                    n !== i,
                                                            ),
                                                        )
                                                    }
                                                    aria-label={
                                                        'Remove ' + f.name
                                                    }
                                                >
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {progress !== null && (
                                    <div className="relay-upload">
                                        <progress value={progress} max={100} />
                                        <span>Uploading {progress}%</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                uploadAbort.current?.abort()
                                            }
                                        >
                                            Cancel upload
                                        </button>
                                    </div>
                                )}
                                <div className="relay-compose-box">
                                    <label
                                        className="relay-icon"
                                        title="Attach files"
                                    >
                                        <Paperclip />
                                        <input
                                            type="file"
                                            multiple
                                            hidden
                                            disabled={progress !== null}
                                            onChange={(e) => {
                                                setFiles((old) => [
                                                    ...old,
                                                    ...Array.from(
                                                        e.target.files ?? [],
                                                    ),
                                                ]);
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                    <textarea
                                        rows={1}
                                        placeholder="Write a message…"
                                        aria-label="Message"
                                        maxLength={4000}
                                        value={draft}
                                        disabled={progress !== null}
                                        onChange={(e) => {
                                            setDraft(e.target.value);
                                            if (
                                                Date.now() -
                                                    sentTypingAt.current >
                                                    6000 &&
                                                connection === 'connected'
                                            ) {
                                                sentTypingAt.current =
                                                    Date.now();
                                                void api(
                                                    conversationsRoute.typing(
                                                        selected.id,
                                                    ),
                                                ).catch(() => {});
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === 'Enter' &&
                                                !e.shiftKey
                                            ) {
                                                e.preventDefault();
                                                if (
                                                    draft.trim() ||
                                                    files.length
                                                )
                                                    void send();
                                            }
                                        }}
                                    />
                                    <button
                                        className="relay-send"
                                        disabled={
                                            progress !== null ||
                                            (!draft.trim() && !files.length) ||
                                            !online
                                        }
                                        aria-label="Send message"
                                    >
                                        <Send size={19} />
                                    </button>
                                </div>
                                <small>
                                    Enter to send · Shift + Enter for a new line{' '}
                                    <span>
                                        <Shield size={11} /> Private
                                        conversation
                                    </span>
                                </small>
                            </form>
                        </>
                    ) : (
                        <div className="relay-welcome">
                            <span className="relay-welcome-icon">
                                <MessageCircle size={44} />
                            </span>
                            <small>LESS NOISE. MORE CONNECTION.</small>
                            <h2>
                                A little closer,
                                <br />
                                wherever you are.
                            </h2>
                            <p>
                                A private space for conversations that matter.
                                <br />
                                Choose a conversation or start a new one.
                            </p>
                            <button
                                className="relay-primary"
                                onClick={() => setPanel('new')}
                            >
                                <Plus size={18} /> New conversation
                            </button>
                            <div className="relay-features">
                                <span>
                                    <Shield size={16} />
                                    Private workspace
                                </span>
                                <span>
                                    <Paperclip size={16} />
                                    Share anything
                                </span>
                                <span>
                                    <Video size={16} />
                                    Face to face
                                </span>
                            </div>
                        </div>
                    )}
                </main>

                {panel && (
                    <div className="relay-overlay">
                        <section
                            role="dialog"
                            aria-modal="true"
                            aria-label={panel}
                            className={
                                'relay-modal ' +
                                (panel === 'admin' ? 'wide' : '')
                            }
                        >
                            <header>
                                <div>
                                    <small>RELAY WORKSPACE</small>
                                    <h2>
                                        {panel === 'new'
                                            ? 'Start a conversation'
                                            : panel === 'notifications'
                                              ? 'Your updates'
                                              : panel === 'profile'
                                                ? 'Make yourself at home'
                                                : 'Workspace administration'}
                                    </h2>
                                </div>
                                <button
                                    className="relay-icon"
                                    autoFocus
                                    onClick={() => setPanel(null)}
                                    aria-label="Close panel"
                                >
                                    <X />
                                </button>
                            </header>
                            {panel === 'new' && (
                                <>
                                    <label className="relay-search">
                                        <Search size={16} />
                                        <input
                                            autoFocus
                                            placeholder="Search people by name"
                                            value={peopleQuery}
                                            onChange={(e) =>
                                                setPeopleQuery(e.target.value)
                                            }
                                        />
                                    </label>
                                    {people.length ? (
                                        people.map((p) => (
                                            <button
                                                className="relay-person"
                                                key={p.id}
                                                onClick={() =>
                                                    void newConversation(p)
                                                }
                                            >
                                                <Avatar person={p} />
                                                <div>
                                                    <strong>{p.name}</strong>
                                                    <small>
                                                        {p.online
                                                            ? 'Online now'
                                                            : 'Start a private conversation'}
                                                    </small>
                                                </div>
                                                <ArrowUpRight size={18} />
                                            </button>
                                        ))
                                    ) : (
                                        <p className="relay-muted py-6">
                                            No active users found. An admin can
                                            create accounts for your teammates.
                                        </p>
                                    )}
                                    {peopleNext && (
                                        <button
                                            className="relay-secondary"
                                            onClick={() =>
                                                void api<Page<Person>>(
                                                    peopleNext,
                                                )
                                                    .then((r) => {
                                                        setPeople((old) => [
                                                            ...old,
                                                            ...r.data,
                                                        ]);
                                                        setPeopleNext(
                                                            r.links?.next ??
                                                                null,
                                                        );
                                                    })
                                                    .catch(fail)
                                            }
                                        >
                                            More people
                                        </button>
                                    )}
                                </>
                            )}
                            {panel === 'notifications' && (
                                <>
                                    <div className="relay-notification-settings">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={messageSound.enabled}
                                                disabled={
                                                    messageSound.status ===
                                                    'unsupported'
                                                }
                                                onChange={(e) =>
                                                    messageSound.setEnabled(
                                                        e.target.checked,
                                                    )
                                                }
                                            />
                                            Play a sound for new messages
                                        </label>
                                        <button
                                            className="relay-secondary"
                                            disabled={
                                                !messageSound.enabled ||
                                                messageSound.status ===
                                                    'unsupported'
                                            }
                                            title={
                                                !messageSound.enabled
                                                    ? 'Enable message sounds first'
                                                    : undefined
                                            }
                                            onClick={() =>
                                                void messageSound.testSound()
                                            }
                                        >
                                            Test sound
                                        </button>
                                        <small role="status">
                                            {messageSound.status ===
                                            'unsupported'
                                                ? 'Sound alerts are unavailable in this browser.'
                                                : !messageSound.enabled
                                                  ? 'Message sounds are muted on this browser.'
                                                  : messageSound.status ===
                                                      'blocked'
                                                    ? 'Click Test sound to allow audio alerts in this browser.'
                                                    : 'Sound alerts are ready. No sound plays while you are viewing the conversation.'}
                                        </small>
                                        <button
                                            className="relay-secondary"
                                            onClick={() =>
                                                void (async () => {
                                                    if (
                                                        !(
                                                            'Notification' in
                                                            window
                                                        )
                                                    ) {
                                                        setError(
                                                            'This browser does not support notifications.',
                                                        );
                                                        return;
                                                    }
                                                    if (browserAlerts) {
                                                        setBrowserAlerts(false);
                                                        localStorage.setItem(
                                                            'relay-alerts',
                                                            'no',
                                                        );
                                                        return;
                                                    }
                                                    const permission =
                                                        await Notification.requestPermission();
                                                    setBrowserAlerts(
                                                        permission ===
                                                            'granted',
                                                    );
                                                    localStorage.setItem(
                                                        'relay-alerts',
                                                        permission === 'granted'
                                                            ? 'yes'
                                                            : 'no',
                                                    );
                                                    if (
                                                        permission !== 'granted'
                                                    )
                                                        setError(
                                                            'Browser notifications are blocked. Enable them in browser site settings.',
                                                        );
                                                })()
                                            }
                                        >
                                            {browserAlerts
                                                ? 'Disable browser alerts'
                                                : 'Enable browser alerts'}
                                        </button>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={previewAlerts}
                                                onChange={(e) => {
                                                    setPreviewAlerts(
                                                        e.target.checked,
                                                    );
                                                    localStorage.setItem(
                                                        'relay-previews',
                                                        e.target.checked
                                                            ? 'yes'
                                                            : 'no',
                                                    );
                                                }}
                                            />{' '}
                                            Show sender names in browser alerts
                                        </label>
                                        <small>
                                            Live alerts require Relay to be
                                            open. Background push is not
                                            enabled.
                                        </small>
                                    </div>
                                    {notices.length ? (
                                        notices.map((n) => (
                                            <button
                                                className={
                                                    'relay-notice ' +
                                                    (!n.read_at ? 'unread' : '')
                                                }
                                                key={n.id}
                                                onClick={() =>
                                                    void (async () => {
                                                        try {
                                                            await api(
                                                                noticesRoute.read(
                                                                    n.id,
                                                                ),
                                                            );
                                                            setNotices((old) =>
                                                                old.map((x) =>
                                                                    x.id ===
                                                                    n.id
                                                                        ? {
                                                                              ...x,
                                                                              read_at:
                                                                                  new Date().toISOString(),
                                                                          }
                                                                        : x,
                                                                ),
                                                            );
                                                            const c = await api<
                                                                Envelope<Conversation>
                                                            >(
                                                                conversationsRoute.show(
                                                                    n.data
                                                                        .conversation_id,
                                                                ),
                                                            );
                                                            await open(c.data);
                                                            setPanel(null);
                                                        } catch (e) {
                                                            fail(e);
                                                        }
                                                    })()
                                                }
                                            >
                                                <Bell size={18} />
                                                <div>
                                                    <strong>
                                                        {n.kind.replaceAll(
                                                            '_',
                                                            ' ',
                                                        )}
                                                    </strong>
                                                    <small>
                                                        {n.data.sender_name ??
                                                            'Open conversation'}{' '}
                                                        ·{' '}
                                                        {new Date(
                                                            n.created_at,
                                                        ).toLocaleString()}
                                                    </small>
                                                </div>
                                                {!n.read_at && <i />}
                                            </button>
                                        ))
                                    ) : (
                                        <p className="relay-muted py-6">
                                            You’re all caught up.
                                        </p>
                                    )}
                                    {noticeCursor && (
                                        <button
                                            className="relay-secondary"
                                            onClick={() =>
                                                void api<Page<Notice>>(
                                                    noticesRoute.index({
                                                        query: {
                                                            cursor: noticeCursor,
                                                        },
                                                    }),
                                                )
                                                    .then((r) => {
                                                        setNotices((old) => [
                                                            ...old,
                                                            ...r.data,
                                                        ]);
                                                        setNoticeCursor(
                                                            r.next_cursor ??
                                                                null,
                                                        );
                                                    })
                                                    .catch(fail)
                                            }
                                        >
                                            Earlier updates
                                        </button>
                                    )}
                                    <h3 className="mt-6 font-semibold">
                                        Recent calls
                                    </h3>
                                    {callHistory.map((c) => (
                                        <p
                                            key={c.id}
                                            className="relay-muted py-2"
                                        >
                                            {c.kind} call · {c.status} ·{' '}
                                            {new Date(
                                                c.expires_at,
                                            ).toLocaleDateString()}
                                        </p>
                                    ))}
                                </>
                            )}
                            {panel === 'profile' && (
                                <>
                                    <form
                                        className="relay-form"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            const data = new FormData();
                                            data.append('name', name);
                                            if (avatar)
                                                data.append('avatar', avatar);
                                            void api<Envelope<Person>>(
                                                profileRoute.update(),
                                                data,
                                            )
                                                .then((r) => {
                                                    setSelf(r.data);
                                                    setPanel(null);
                                                })
                                                .catch(fail);
                                        }}
                                    >
                                        <Avatar person={self} />
                                        <label>
                                            Display name
                                            <input
                                                required
                                                maxLength={100}
                                                value={name}
                                                onChange={(e) =>
                                                    setName(e.target.value)
                                                }
                                            />
                                        </label>
                                        <label>
                                            Avatar (JPEG, PNG or WebP, up to 2
                                            MB)
                                            <input
                                                type="file"
                                                accept="image/jpeg,image/png,image/webp"
                                                onChange={(e) =>
                                                    setAvatar(
                                                        e.target.files?.[0] ??
                                                            null,
                                                    )
                                                }
                                            />
                                        </label>
                                        <button className="relay-primary">
                                            Save profile
                                        </button>
                                        <p className="relay-muted">
                                            To change your email or account
                                            status, contact an administrator.
                                        </p>
                                    </form>
                                    <ChangePassword />
                                </>
                            )}
                            {panel === 'admin' && (
                                <AdminPanel
                                    selfId={self.id}
                                    onError={setError}
                                />
                            )}
                        </section>
                    </div>
                )}
                {viewer && (
                    <div className="relay-overlay">
                        <section
                            role="dialog"
                            aria-modal="true"
                            aria-label={viewer.name}
                            className="relay-viewer"
                        >
                            <header>
                                <h2>{viewer.name}</h2>
                                <a href={viewer.download_url}>Download</a>
                                <button
                                    autoFocus
                                    onClick={() => setViewer(null)}
                                    aria-label="Close viewer"
                                >
                                    <X />
                                </button>
                            </header>
                            {viewer.mime.startsWith('video/') ? (
                                <video src={viewer.url} controls autoPlay />
                            ) : (
                                <img src={viewer.url} alt={viewer.name} />
                            )}
                        </section>
                    </div>
                )}
                {call.call && (
                    <div className="relay-overlay call-overlay">
                        <section
                            role="dialog"
                            aria-modal="true"
                            aria-label="Call"
                            className="relay-call"
                        >
                            <small>
                                RELAY {call.call.kind.toUpperCase()} CALL
                            </small>
                            <h2>
                                {conversations.find(
                                    (c) => c.id === call.call?.conversation_id,
                                )?.peer.name ?? 'Private call'}
                            </h2>
                            <p role="status">
                                {call.call.status === 'ringing'
                                    ? call.call.callee_id === self.id
                                        ? 'Incoming call…'
                                        : 'Calling…'
                                    : call.call.ended_at
                                      ? call.call.status
                                      : call.call.connected_at ||
                                          call.connectedAt
                                        ? 'Connected'
                                        : 'Connecting audio…'}
                                {(call.call.connected_at || call.connectedAt) &&
                                    ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
                            </p>
                            {call.call.status === 'ringing' &&
                                call.call.callee_id === self.id &&
                                call.ringtoneBlocked && (
                                    <button
                                        className="relay-secondary"
                                        onClick={() =>
                                            void call.enableRingtone()
                                        }
                                    >
                                        Enable incoming ringtone
                                    </button>
                                )}
                            {activeCall && (
                                <div
                                    className={
                                        'relay-call-video ' +
                                        (call.call.kind === 'audio'
                                            ? 'voice-only'
                                            : '')
                                    }
                                >
                                    <Media stream={call.remote} />
                                    {call.call.kind === 'video' && (
                                        <div className="relay-local">
                                            {call.cameraAvailable ? (
                                                <Media
                                                    stream={call.local}
                                                    muted
                                                />
                                            ) : (
                                                <div
                                                    className="relay-camera-placeholder"
                                                    role="status"
                                                >
                                                    <VideoOff size={22} />
                                                    <span>
                                                        No camera
                                                        <br />
                                                        Audio only
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {call.call.kind === 'audio' && (
                                        <Phone size={56} />
                                    )}
                                </div>
                            )}
                            <div className="relay-call-controls">
                                {call.call.ended_at ? (
                                    <div className="relay-call-finished">
                                        {call.ending ? (
                                            <p role="status">
                                                <LoaderCircle
                                                    className="animate-spin"
                                                    size={18}
                                                />
                                                Ending call…
                                            </p>
                                        ) : call.endError ? (
                                            <>
                                                <p role="alert">
                                                    {call.endError}
                                                </p>
                                                <div className="flex justify-center gap-3">
                                                    <button
                                                        className="relay-danger relay-hangup"
                                                        onClick={call.retryEnd}
                                                    >
                                                        Retry hang-up
                                                    </button>
                                                    <button
                                                        className="relay-secondary"
                                                        onClick={call.dismiss}
                                                    >
                                                        Close
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <button
                                                className="relay-secondary"
                                                onClick={call.dismiss}
                                            >
                                                Close
                                            </button>
                                        )}
                                    </div>
                                ) : call.call.status === 'ringing' &&
                                  call.call.callee_id === self.id ? (
                                    <>
                                        <button
                                            className="relay-primary"
                                            disabled={
                                                call.accepting || call.ending
                                            }
                                            onClick={() => void call.accept()}
                                        >
                                            {call.accepting ? (
                                                <LoaderCircle className="animate-spin" />
                                            ) : (
                                                <Phone />
                                            )}
                                            {call.accepting
                                                ? 'Connecting…'
                                                : 'Accept'}
                                        </button>
                                        <button
                                            className="relay-danger relay-hangup"
                                            disabled={call.ending}
                                            onClick={() =>
                                                void call
                                                    .action('reject')
                                                    .catch(fail)
                                            }
                                        >
                                            <PhoneOff />
                                            Reject
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="relay-icon"
                                            aria-label={
                                                call.muted
                                                    ? 'Unmute microphone'
                                                    : 'Mute microphone'
                                            }
                                            onClick={call.toggleMute}
                                        >
                                            {call.muted ? <MicOff /> : <Mic />}
                                        </button>
                                        {call.call.kind === 'video' && (
                                            <button
                                                className="relay-icon"
                                                disabled={!call.cameraAvailable}
                                                title={
                                                    !call.cameraAvailable
                                                        ? 'No camera source. Your microphone remains available.'
                                                        : undefined
                                                }
                                                aria-label={
                                                    call.camera
                                                        ? 'Turn camera off'
                                                        : 'Turn camera on'
                                                }
                                                onClick={call.toggleCamera}
                                            >
                                                {call.camera ? (
                                                    <Video />
                                                ) : (
                                                    <VideoOff />
                                                )}
                                            </button>
                                        )}
                                        <button
                                            className="relay-danger relay-hangup"
                                            disabled={call.ending}
                                            aria-label={
                                                call.call.status === 'ringing'
                                                    ? 'Cancel call'
                                                    : 'End call'
                                            }
                                            onClick={() =>
                                                void call
                                                    .action(
                                                        call.call?.status ===
                                                            'ringing'
                                                            ? 'cancel'
                                                            : 'end',
                                                    )
                                                    .catch(fail)
                                            }
                                        >
                                            <PhoneOff size={20} />
                                            {call.call.status === 'ringing'
                                                ? 'Cancel call'
                                                : 'End call'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </>
    );
}
