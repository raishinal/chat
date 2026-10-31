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
        [password, setPassword] = useState(''),
        [confirmation, setConfirmation] = useState(''),
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
        setStatus(u?.status === 'pending' ? 'active' : (u?.status ?? 'active'));
        setPassword('');
        setConfirmation('');
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
                ...(status !== 'pending' ? { status } : {}),
                ...(!edit || password
                    ? { password, password_confirmation: confirmation }
                    : {}),
            });
            setCreating(false);
            setNotice(
                edit
                    ? 'User updated.'
                    : 'User created. They can sign in immediately.',
            );
            await load();
        } catch (e) {
            fail(e);
        } finally {
            setPassword('');
            setConfirmation('');
            setBusy(false);
        }
    }
    async function remove(u: User) {
        const confirmation = window.prompt(
            `Permanently delete ${u.email}? This deletes their shared conversations, messages and files for both participants. This cannot be undone. Type the account email to confirm.`,
        );
        if (confirmation !== u.email) return;
        setBusy(true);
        try {
            await api(routes.destroy(u.id), { confirmation });
            setNotice('Account permanently deleted. File cleanup queued.');
            await load();
        } catch (error) {
            fail(error);
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
                Active = activated, unsuspended accounts. Pending = legacy
                accounts that need a password before activation. Storage
                includes retained uploads. Private content is visible only to
                participants.
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
                    Create user
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
                    <h3>{edit ? 'Edit account' : 'Create user'}</h3>
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
                    {edit && (
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
                    <label>
                        {edit
                            ? 'New password (leave blank to keep current)'
                            : 'Password'}
                        <input
                            type="password"
                            autoComplete="new-password"
                            minLength={8}
                            required={!edit || edit.status === 'pending'}
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                        />
                    </label>
                    <label>
                        Confirm password
                        <input
                            type="password"
                            autoComplete="new-password"
                            minLength={8}
                            required={
                                !edit || edit.status === 'pending' || !!password
                            }
                            value={confirmation}
                            onChange={(event) =>
                                setConfirmation(event.target.value)
                            }
                        />
                    </label>
                    {edit && password && (
                        <small>
                            Changing the password signs this user out on all
                            devices.
                        </small>
                    )}
                    <div className="flex gap-3">
                        <button className="relay-primary" disabled={busy}>
                            {busy
                                ? 'Saving…'
                                : edit
                                  ? 'Save account'
                                  : 'Create user'}
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
                                    <button
                                        disabled={busy || u.id === selfId}
                                        onClick={() => void remove(u)}
                                    >
                                        Delete permanently
                                    </button>
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
