/** Terminal call actions are idempotent, so a lost response can be retried safely. */
export async function confirmCallEnd(
    send: (signal: AbortSignal) => Promise<void>,
    isConfirmed: () => boolean,
    timeoutMs = 10000,
): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (isConfirmed()) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            await send(controller.signal);
            return;
        } catch (error) {
            if (isConfirmed()) return;
            const status =
                typeof error === 'object' && error !== null && 'status' in error
                    ? Number(error.status)
                    : 0;
            // Authentication and validation failures require user action.
            if (
                attempt === 1 ||
                (status >= 400 && status < 500 && ![408, 429].includes(status))
            )
                throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}
