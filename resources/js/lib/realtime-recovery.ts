type Client = {
    connection: { state: string };
    connect(): void;
    disconnect(): void;
    allChannels(): {
        subscribed: boolean;
        subscriptionPending: boolean;
        subscribe(): void;
    }[];
};
export type RealtimeRecovery = { resume(): Promise<void>; dispose(): void };
export function createRealtimeRecovery<T>(options: {
    client: Client;
    getSession(): Promise<T>;
    onSession(session: T): void;
    onExpired(): void;
    onReconnect(): void;
    onIssue(message: string): void;
    onRefresh(): void;
    now?: () => number;
}): RealtimeRecovery {
    const now = options.now ?? Date.now;
    let lastActive = now(),
        lastAttempt = -Infinity;
    let pending: Promise<void> | null = null;
    let disposed = false,
        expired = false;
    function resume(): Promise<void> {
        if (disposed || expired) return Promise.resolve();
        if (pending) return pending;
        if (now() - lastAttempt < 5000) return Promise.resolve();
        const stale = now() - lastActive > 60000;
        lastAttempt = now();
        pending = (async () => {
            try {
                // Check the account/session before reauthorizing private channels.
                const session = await options.getSession();
                if (disposed) return;
                options.onSession(session);
                if (options.client.connection.state !== 'connected' || stale) {
                    options.onReconnect();
                    if (options.client.connection.state === 'connected')
                        options.client.disconnect();
                    options.client.connect();
                } else {
                    // Failed authorization is not automatically retried on a healthy socket.
                    for (const channel of options.client.allChannels()) {
                        if (!channel.subscribed && !channel.subscriptionPending)
                            channel.subscribe();
                    }
                }
                lastActive = now();
                options.onRefresh();
            } catch (error) {
                if (disposed) return;
                const status =
                    typeof error === 'object' &&
                    error !== null &&
                    'status' in error
                        ? error.status
                        : undefined;
                if (status === 401 || status === 419 || status === 403) {
                    expired = true;
                    options.client.disconnect();
                    options.onExpired();
                } else
                    options.onIssue(
                        'Connection interrupted. We will retry when the network is available.',
                    );
            } finally {
                pending = null;
            }
        })();
        return pending;
    }
    return {
        resume,
        dispose: () => {
            disposed = true;
        },
    };
}

export function realtimeConnectionIssue(error: unknown): string {
    const code = (error as { error?: { data?: { code?: number } } } | null)
        ?.error?.data?.code;
    return code === 4004
        ? 'Pusher connection limit reached. Close extra tabs or check your Pusher plan.'
        : code && code >= 4000 && code < 4100
          ? `Live service rejected the connection (Pusher code ${code}). Retry or check the service configuration.`
          : 'Live connection interrupted. Reconnecting automatically…';
}
