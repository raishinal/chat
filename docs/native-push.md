# Native push delivery

The native client guide `docs/native-push-setup.md` contains the complete mobile
configuration and device verification procedure. Live delivery requires Firebase
and Apple Developer accounts; Firebase is configured and verified locally; Apple setup and hosted-server deployment remain pending.

On the backend, install Composer dependencies, migrate the database, and set:

```dotenv
FIREBASE_CREDENTIALS=/private/path/firebase-service-account.json
APNS_KEY_PATH=/private/path/AuthKey.p8
APNS_KEY_ID=your-apple-key-id
APNS_TEAM_ID=your-apple-team-id
APNS_TOPIC=com.relay.privatechat
APNS_SANDBOX=true
```

Private files must stay outside the public directory and repository. The Firebase
service account needs FCM send permission. APNs needs HTTP/2 support in cURL;
use `APNS_SANDBOX=false` for TestFlight and App Store builds. Configure the APNs key
in Firebase too for ordinary iOS messages. Never send credentials to mobile clients.

```sh
php artisan migrate --force
php artisan config:cache
php artisan queue:work --queue=push,default --tries=3 --timeout=90
```

Supervise workers, keep the existing call-expiry scheduler running, and restart
workers after deployment. Use a real queue connection such as database or Redis.
Jobs dispatch after commit, fetch the latest call state, retry transient provider
errors, and deduplicate deliveries already completed for other devices. Failed job
exceptions intentionally exclude credentials and tokens. Monitor failed jobs.

Device tokens are encrypted and bound to an active, unexpired mobile login.
Account switching replaces the installation's prior registration; token revocation
deletes registrations. Old clients must register again after this migration.
Message previews show sender name and a generic “New message”, without message text.
Incoming iOS calls use VoIP pushes; later call state uses ordinary background FCM/APNs.
OS restrictions mean cancellation pushes and other background updates may be delayed;
the native client also expires ringing calls locally.

Changed backend files pass PHPStan; the backend test suite has 129 passes and 2 skips.
The full PHPStan run still reports the pre-existing always-true token check in
`PasswordController.php:30`. No signed native build or provider/device test has been
performed. Use physical devices to verify closed-app ringing, answer/decline,
background audio, stale/cancelled calls, sign-out, token rotation and network loss.
