import { useState } from 'react';
import { api } from '@/lib/chat-api';
import { password as passwordRoute } from '@/routes/api/profile';

export default function ChangePassword() {
    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    return (
        <form
            className="relay-form"
            onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setMessage('');
                setError('');
                try {
                    const result = await api<{ message: string }>(
                        passwordRoute(),
                        {
                            current_password: current,
                            password,
                            password_confirmation: confirmation,
                        },
                    );
                    setMessage(result.message);
                } catch (error) {
                    setError((error as Error).message);
                } finally {
                    setCurrent('');
                    setPassword('');
                    setConfirmation('');
                    setBusy(false);
                }
            }}
        >
            <h3>Change password</h3>
            <label>
                Current password
                <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={current}
                    onChange={(event) => setCurrent(event.target.value)}
                    disabled={busy}
                />
            </label>
            <label>
                New password
                <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                />
            </label>
            <label>
                Confirm new password
                <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={busy}
                />
            </label>
            <small>
                Use at least 8 characters. Other devices will be signed out.
            </small>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <button className="relay-primary" disabled={busy}>
                {busy ? 'Changing password…' : 'Change password'}
            </button>
        </form>
    );
}
