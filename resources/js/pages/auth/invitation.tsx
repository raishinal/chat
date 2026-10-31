import { Form, Head } from '@inertiajs/react';
import { accept } from '@/routes/invitation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function Invitation({
    invitation,
    token,
    email,
}: {
    invitation: number;
    token: string;
    email: string;
}) {
    return (
        <>
            <Head title="Accept invitation" />
            <p className="mb-6 text-sm text-muted-foreground">
                Activate your private account for {email}. Choose a password
                with at least 8 characters.
            </p>
            <Form {...accept.form(invitation)} className="grid gap-4">
                {({ errors, processing }) => (
                    <>
                        <input type="hidden" name="token" value={token} />
                        <label>
                            New password
                            <Input
                                type="password"
                                name="password"
                                minLength={8}
                                autoComplete="new-password"
                                required
                            />
                        </label>
                        <label>
                            Confirm password
                            <Input
                                type="password"
                                name="password_confirmation"
                                minLength={8}
                                autoComplete="new-password"
                                required
                            />
                        </label>
                        <p role="alert" className="text-sm text-red-600">
                            {Object.values(errors).join(' ')}
                        </p>
                        <Button disabled={processing}>Activate account</Button>
                    </>
                )}
            </Form>
        </>
    );
}
Invitation.layout = {
    title: 'Welcome to Relay',
    description: 'A private space for your team.',
};
