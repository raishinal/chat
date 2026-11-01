/** Keep a short-lived credential request scoped to one call, never across calls. */
export function createCallConnectivityLoader<T>(
    fetchConnectivity: (signal: AbortSignal) => Promise<T>,
    now = () => Date.now(),
) {
    let cached: {
        callId: number;
        startedAt: number;
        pending: boolean;
        controller: AbortController;
        promise: Promise<T>;
    } | null = null;

    function clear() {
        cached?.controller.abort();
        cached = null;
    }

    function load(callId: number): Promise<T> {
        if (
            cached?.callId === callId &&
            (cached.pending || now() - cached.startedAt < 10000)
        )
            return cached.promise;
        clear();
        const controller = new AbortController();
        const entry = {
            callId,
            startedAt: now(),
            pending: true,
            controller,
            promise: Promise.resolve().then(() =>
                fetchConnectivity(controller.signal),
            ),
        };
        cached = entry;
        entry.promise = entry.promise.then(
            (value) => {
                entry.pending = false;
                return value;
            },
            (error: unknown) => {
                if (cached === entry) cached = null;
                throw error;
            },
        );
        return entry.promise;
    }

    return { load, clear };
}
