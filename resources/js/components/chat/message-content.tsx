import { useEffect, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api, type Attachment, type Message } from '@/lib/chat-api';
import * as messagesRoute from '@/routes/api/messages';
import * as attachmentsRoute from '@/routes/api/attachments';

export default function MessageContent({
    message,
    own,
    renderAttachment,
    onChange,
}: {
    message: Message;
    own: boolean;
    renderAttachment: (attachment: Attachment) => ReactNode;
    onChange: (message: Message) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [body, setBody] = useState(message.body ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (message.deleted_at) setEditing(false);
    }, [message.deleted_at]);

    async function mutate(
        action: 'edit' | 'delete' | 'file',
        attachment?: Attachment,
    ) {
        if (busy) return;
        if (
            action !== 'edit' &&
            !window.confirm(
                action === 'file'
                    ? `Delete “${attachment?.name}” for everyone?`
                    : 'Delete this message and its files for everyone?',
            )
        )
            return;
        setBusy(true);
        setError('');
        try {
            if (action === 'file' && attachment) {
                await api(attachmentsRoute.destroy(attachment.id));
                const attachments = message.attachments.filter(
                    (a) => a.id !== attachment.id,
                );
                onChange({
                    ...message,
                    attachments,
                    deleted_at:
                        !message.body?.trim() && !attachments.length
                            ? new Date().toISOString()
                            : message.deleted_at,
                });
            } else {
                const result = await api<{ data: Message }>(
                    action === 'edit'
                        ? messagesRoute.update(message.id)
                        : messagesRoute.destroy(message.id),
                    action === 'edit' ? { body } : undefined,
                );
                onChange(result.data);
                setEditing(false);
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    if (message.deleted_at)
        return <p className="italic opacity-70">Message deleted</p>;
    const canManage = own && !message.pending && !message.failed;
    return (
        <>
            {editing ? (
                <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void mutate('edit');
                    }}
                >
                    <textarea
                        aria-label="Edit message"
                        autoFocus
                        maxLength={4000}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        disabled={busy}
                        className="min-h-20 w-full rounded border border-current/30 bg-transparent p-2 text-inherit"
                    />
                    <div className="flex gap-3 text-xs">
                        <button
                            type="submit"
                            disabled={
                                busy ||
                                (!body.trim() && !message.attachments.length)
                            }
                        >
                            {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                setEditing(false);
                                setError('');
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : (
                message.body && <p>{message.body}</p>
            )}
            {message.attachments.map((a) => (
                <div key={a.id} className="flex flex-col gap-1">
                    {renderAttachment(a)}
                    {canManage && (
                        <button
                            type="button"
                            disabled={busy || editing}
                            aria-label={`Delete file ${a.name}`}
                            onClick={() => void mutate('file', a)}
                            className="flex items-center gap-1 self-end py-1 text-xs opacity-75 hover:opacity-100 disabled:opacity-40"
                        >
                            <Trash2 size={12} />
                            Delete file
                        </button>
                    )}
                </div>
            ))}
            {message.edited_at && (
                <span className="text-xs opacity-65">Edited</span>
            )}
            {canManage && !editing && (
                <div className="mt-2 flex justify-end gap-3 text-xs">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setBody(message.body ?? '');
                            setEditing(true);
                            setError('');
                        }}
                        className="flex items-center gap-1 py-1 opacity-75 hover:opacity-100 disabled:opacity-40"
                    >
                        <Pencil size={12} />
                        Edit
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate('delete')}
                        className="flex items-center gap-1 py-1 opacity-75 hover:opacity-100 disabled:opacity-40"
                    >
                        <Trash2 size={12} />
                        {busy ? 'Deleting…' : 'Delete'}
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="mt-2 text-xs">
                    {error}
                </p>
            )}
        </>
    );
}
