function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Call ended.', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, ms);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

/** Retry temporary signaling failures without flooding a saturated server. */
export async function retryCallSignal(
    send: (signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
    wait = delay,
    timeoutMs = 8000,
): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();
        const request = new AbortController();
        const abort = () => request.abort();
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        let failure: unknown;
        try {
            await send(request.signal);
            return;
        } catch (error) {
            signal.throwIfAborted();
            const status =
                typeof error === 'object' && error !== null && 'status' in error
                    ? Number(error.status)
                    : 0;
            if (status >= 400 && status < 500 && ![408, 429].includes(status))
                throw error;
            failure = error;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
        if (attempt === 2) {
            throw new Error(
                'Call setup could not reach the signaling server after retrying. Please redial.',
                { cause: failure },
            );
        }
        await wait(500 * (attempt + 1), signal);
    }
}
