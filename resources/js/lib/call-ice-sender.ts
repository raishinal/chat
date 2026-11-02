/** Bound HTTP concurrency during ICE gathering on hosts with small DB limits. */
export function createCallIceSender<T>(
    send: (candidate: T, signal: AbortSignal) => Promise<unknown>,
    onError: (error: unknown) => void,
) {
    const controller = new AbortController();
    let pending = Promise.resolve();

    function enqueue(candidate: T): Promise<void> {
        pending = pending
            .then(async () => {
                if (!controller.signal.aborted)
                    await send(candidate, controller.signal);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) onError(error);
            });
        return pending;
    }

    return { enqueue, stop: () => controller.abort() };
}
