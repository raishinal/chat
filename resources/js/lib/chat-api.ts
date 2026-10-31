export type Endpoint = { url: string; method: string };
export function csrfHeaders(): Record<string, string> {
    const token = document.cookie
        .split('; ')
        .find((c) => c.startsWith('XSRF-TOKEN='))
        ?.split('=')
        .slice(1)
        .join('=');
    return token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {};
}
export async function api<T>(
    route: Endpoint | string,
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    const endpoint =
        typeof route === 'string' ? { url: route, method: 'get' } : route;
    const response = await fetch(endpoint.url, {
        method: endpoint.method.toUpperCase(),
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            ...csrfHeaders(),
            ...(body instanceof FormData
                ? {}
                : { 'Content-Type': 'application/json' }),
        },
        body:
            body === undefined
                ? undefined
                : body instanceof FormData
                  ? body
                  : JSON.stringify(body),
        signal,
    });
    if (!response.ok) {
        const data = await response
            .json()
            .catch(() => ({ message: response.statusText }));
        throw new Error(
            response.status === 401 || response.status === 419
                ? 'Your session expired. Reload and sign in again.'
                : Object.values(data.errors ?? {})
                      .flat()
                      .join(' ') ||
                      data.message ||
                      'Request failed',
        );
    }
    return response.status === 204 ? (undefined as T) : response.json();
}
export function upload<T>(
    endpoint: Endpoint,
    files: File[],
    onProgress: (n: number) => void,
    signal: AbortSignal,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint.url);
        xhr.setRequestHeader('Accept', 'application/json');
        Object.entries(csrfHeaders()).forEach(([k, v]) =>
            xhr.setRequestHeader(k, v),
        );
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
                onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
            const data = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else
                reject(
                    new Error(
                        Object.values(data.errors ?? {})
                            .flat()
                            .join(' ') ||
                            data.message ||
                            'Upload failed',
                    ),
                );
        };
        xhr.onerror = () =>
            reject(new Error('Upload failed. Check your connection.'));
        xhr.onabort = () => reject(new Error('Upload cancelled.'));
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
        const form = new FormData();
        files.forEach((f) => form.append('files[]', f));
        xhr.send(form);
    });
}
export type Person = {
    id: number;
    name: string;
    role: string;
    status: string;
    online: boolean;
    last_seen_at: string | null;
    avatar_url: string | null;
};
export type Attachment = {
    id: number;
    name: string;
    mime: string;
    size: number;
    previewable: boolean;
    url: string;
    download_url: string;
    thumbnail_url: string | null;
};
export type Message = {
    id: number;
    conversation_id: number;
    sender_id: number;
    client_id: string;
    body: string | null;
    created_at: string;
    attachments: Attachment[];
    pending?: boolean;
    failed?: boolean;
};
export type Conversation = {
    id: number;
    peer: Person;
    unread_count: number;
    peer_read_id: number;
    read_id: number;
    latest_message: Message | null;
    updated_at: string;
};
export type Call = {
    id: number;
    conversation_id: number;
    caller_id: number;
    callee_id: number;
    kind: 'audio' | 'video';
    status: string;
    connected_at: string | null;
    ended_at: string | null;
    expires_at: string;
};
export type Notice = {
    id: number;
    kind: string;
    data: {
        conversation_id: number;
        sender_name?: string;
        message_id?: number;
        call_id?: number;
    };
    read_at: string | null;
    created_at: string;
};
export type Page<T> = {
    data: T[];
    links?: { next: string | null };
    meta?: { next_cursor: string | null };
    next_cursor?: string | null;
    next_page_url?: string | null;
};
