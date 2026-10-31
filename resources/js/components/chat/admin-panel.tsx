import { useEffect, useState } from 'react';
import { api } from '@/lib/chat-api';
import * as routes from '@/routes/api/admin';
type User = {
    id: number;
    name: string;
    email: string;
    role: string;
    status: string;
    created_at: string;
    last_seen_at: string | null;
};
type Result = {
    metrics: Record<string, number>;
    users: {
        data: User[];
        next_page_url: string | null;
        current_page: number;
        last_page: number;
    };
};
export default function AdminPanel({
    selfId,
    onError,
}: {
    selfId: number;
    onError: (s: string) => void;
}) {
    const [result, setResult] = useState<Result | null>(null),
        [query, setQuery] = useState(''),
        [page, setPage] = useState(1),
        [edit, setEdit] = useState<User | null>(null),
        [creating, setCreating] = useState(false),
        [name, setName] = useState(''),
        [email, setEmail] = useState(''),
        [role, setRole] = useState('user'),
        [status, setStatus] = useState('active'),
        [busy, setBusy] = useState(false),
        [audit, setAudit] = useState<
            {
                id: number;
                actor_id: number;
                subject_id: number;
                action: string;
                created_at: string;
            }[]
        >([]),
        [notice, setNotice] = useState('');
    const fail = (e: unknown) => onError((e as Error).message);
    async function load() {
        setResult(
            await api<Result>(routes.index({ query: { q: query, page } })),
        );
    }
    useEffect(() => {
        const timer = setTimeout(() => {
            void load().catch(fail);
        }, 250);
        return () => clearTimeout(timer);
    }, [query, page]);
    function start(u?: User) {
        setEdit(u ?? null);
        setName(u?.name ?? '');
        setEmail(u?.email ?? '');
        setRole(u?.role ?? 'user');
        setStatus(u?.status ?? 'active');
        setCreating(true);
        setNotice('');
    }
    async function save() {
        setBusy(true);
        try {
            await api(edit ? routes.update(edit.id) : routes.store(), {
                name,
                email,
                role,
                ...(edit && edit.status !== 'pending' ? { status } : {}),
            });
            setCreating(false);
            setNotice(
                edit ? 'User updated.' : 'Invitation queued for delivery.',
            );
            await load();
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    }
    async function perform(u: User, action: 'invite' | 'reset') {
        setBusy(true);
        try {
            await api(
                action === 'invite' ? routes.invite(u.id) : routes.reset(u.id),
                {},
            );
            setNotice(
                action === 'invite'
                    ? 'Invitation queued for delivery.'
                    : 'Password reset email requested.',
            );
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="relay-admin">
            {notice && (
                <p role="status" className="relay-success">
                    {notice}
                </p>
            )}
            <div className="relay-metrics">
                {Object.entries(result?.metrics ?? {}).map(([key, value]) => (
                    <div key={key}>
                        <small>{key.replaceAll('_', ' ')}</small>
                        <strong>
                            {key === 'storage_bytes'
                                ? `${(value / 1024 / 1024).toFixed(1)} MB`
                                : value}
                        </strong>
                    </div>
                ))}
            </div>
            <p className="relay-muted">
                Active = activated, unsuspended accounts. Pending = awaiting
                invitation acceptance. Storage includes retained uploads.
                Private content is visible only to participants.
            </p>
            <div className="relay-admin-toolbar">
                <label className="relay-search">
                    <input
                        aria-label="Search users"
                        placeholder="Search name or email"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                        }}
                    />
                </label>
                <button className="relay-primary" onClick={() => start()}>
                    Invite user
                </button>
            </div>
            {creating && (
                <form
                    className="relay-form relay-editor"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                    }}
                >
                    <h3>{edit ? 'Edit account' : 'Invite a teammate'}</h3>
                    <label>
                        Name
                        <input
                            required
                            maxLength={100}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <label>
                        Email
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <label>
                        Role
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                        >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </label>
                    {edit && edit.status !== 'pending' && (
                        <label>
                            Status
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                            >
                                <option value="active">Active</option>
                                <option
                                    value="suspended"
                                    disabled={edit.id === selfId}
                                >
                                    Suspended
                                </option>
                            </select>
                        </label>
                    )}
                    <div className="flex gap-3">
                        <button className="relay-primary" disabled={busy}>
                            {busy
                                ? 'Saving…'
                                : edit
                                  ? 'Save account'
                                  : 'Send invitation'}
                        </button>
                        <button
                            type="button"
                            className="relay-secondary"
                            onClick={() => setCreating(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}
            <div className="relay-table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>Person</th>
                            <th>Role / status</th>
                            <th>Joined / last seen</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {result?.users.data.map((u) => (
                            <tr key={u.id}>
                                <td>
                                    <strong>{u.name}</strong>
                                    <small>{u.email}</small>
                                </td>
                                <td>
                                    {u.role}
                                    <small>{u.status}</small>
                                </td>
                                <td>
                                    {new Date(
                                        u.created_at,
                                    ).toLocaleDateString()}
                                    <small>
                                        {u.last_seen_at
                                            ? new Date(
                                                  u.last_seen_at,
                                              ).toLocaleString()
                                            : 'Never'}
                                    </small>
                                </td>
                                <td>
                                    <button onClick={() => start(u)}>
                                        Edit
                                    </button>
                                    {u.status === 'pending' ? (
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                void perform(u, 'invite')
                                            }
                                        >
                                            Resend invite
                                        </button>
                                    ) : (
                                        <button
                                            disabled={
                                                busy || u.status !== 'active'
                                            }
                                            title={
                                                u.status !== 'active'
                                                    ? 'Reactivate this account first'
                                                    : undefined
                                            }
                                            onClick={() =>
                                                void perform(u, 'reset')
                                            }
                                        >
                                            Reset password
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="relay-pagination">
                <button
                    disabled={page === 1}
                    onClick={() => setPage((n) => n - 1)}
                >
                    Previous
                </button>
                <span>
                    Page {result?.users.current_page ?? 1} of{' '}
                    {result?.users.last_page ?? 1}
                </span>
                <button
                    disabled={!result?.users.next_page_url}
                    onClick={() => setPage((n) => n + 1)}
                >
                    Next
                </button>
            </div>
            <button
                className="relay-secondary"
                onClick={() =>
                    void api<{ data: typeof audit }>(routes.audit())
                        .then((r) => setAudit(r.data))
                        .catch(fail)
                }
            >
                Load recent audit log
            </button>
            {audit.map((a) => (
                <p className="relay-muted py-1" key={a.id}>
                    {a.action} · admin #{a.actor_id} · user #{a.subject_id} ·{' '}
                    {new Date(a.created_at).toLocaleString()}
                </p>
            ))}
        </div>
    );
}
