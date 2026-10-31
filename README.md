# Relay — private team chat

A private Laravel 13 / React 19 / TypeScript application built on the existing Inertia 3 starter, with an adjacent React Native client. REST endpoints live at `/api/v1`. Administrators create active users directly with an assigned password; no invitation is sent. No public registration routes or page exist.

## Install and start

Requires PHP 8.3+ with PDO SQLite (or MySQL/PostgreSQL), fileinfo, mbstring, OpenSSL, Composer, and Node 22+. GD is optional for JPEG/PNG/WebP thumbnails. Use versions locked in `composer.lock` and `package-lock.json`.

```powershell
composer install
npm ci
Copy-Item .env.example .env  # NEW installations only; preserve an existing .env
php artisan key:generate    # NEW installations only; never rotate an existing key casually
if (!(Test-Path database/database.sqlite)) { New-Item database/database.sqlite -ItemType File }
php artisan migrate
php artisan chat:admin admin@example.com --name="Workspace Admin"
npm run build
php artisan serve --host=127.0.0.1 --port=8000
```

The admin command requests and confirms a hidden password (minimum 8 characters). The interactive command has no default credentials. Log in at `http://127.0.0.1:8000`. In development, `npm run dev` may replace the build step. Run these in separate terminals:

```powershell
php artisan queue:work --tries=3 --timeout=90
php artisan schedule:work
```

The scheduler expires calls every minute and removes abandoned uploads after 24 hours. Call/API requests also expire stale calls. Production should run `schedule:run` every minute via cron and supervise queue workers. Restart workers after deploying changes with `php artisan queue:restart`.

For local testing, simply run `php artisan db:seed --class=AdminSeeder` to create `admin@example.com` / `password` when seed credentials are blank. To supply your own admin credentials instead, set these backend `.env` values:

```dotenv
SEED_ADMIN_NAME="Workspace Admin"
SEED_ADMIN_EMAIL=your-admin@example.com
SEED_ADMIN_PASSWORD="your-own-unique-password-at-least-8-characters"
```

Then run:

```powershell
php artisan config:clear
php artisan db:seed --class=AdminSeeder
```

`AdminSeeder` is also called by `php artisan db:seed`. It creates a verified, active administrator with a hashed password. With `APP_ENV=local` and both email/password blank, it creates the testing account `admin@example.com` / `password`. Outside local development, blank credentials skip admin creation and explicitly configured passwords require at least 8 characters. Invalid or incomplete credentials fail validation. Rerunning leaves an existing admin's password, role, name and suspension status unchanged; an email belonging to a non-admin is rejected rather than promoted. Remove `SEED_ADMIN_PASSWORD` after provisioning and clear/rebuild the config cache so it no longer retains the secret. Use the interactive `chat:admin` command if you prefer not to configure a password in the environment. In production, run the explicit admin seeder with `--force` after supplying credentials through your secret manager; demo users remain local-only.

Optional local demo users:

```powershell
php artisan db:seed
```

The demo-user portion only runs under `APP_ENV=local`, prints freshly generated passwords once, and adds four ordinary users. The configured admin seeder runs first in every environment. Never create demo users in production. Existing demo accounts are not modified. To create two test accounts without mail, run `chat:admin` twice locally; use Administration → Create user for normal membership. This checkout's existing `.env` points at MySQL; use its database credentials and create the database first, or intentionally change `DB_CONNECTION=sqlite` and remove `DB_DATABASE` for the default SQLite path. The implementation does not overwrite existing environment settings.

## External services

**Pusher Channels:** create an app and set `BROADCAST_CONNECTION=pusher`, `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_APP_CLUSTER`, `VITE_PUSHER_APP_KEY`, and `VITE_PUSHER_APP_CLUSTER`. Rebuild frontend assets after VITE changes. Only key/cluster are public. Enable authenticated users; the web client calls Pusher `signin()` so administrators can terminate authenticated connections on suspension. Queue workers deliver durable updates; SDP/ICE is sent synchronously and never queued. With Pusher disabled, API messaging and 30-second reconciliation work, and call buttons are disabled with an explanation. Do not use a log broadcaster in production because it logs private event contents.

**Mail:** use a real SMTP provider or local Mailpit. Configure `MAIL_MAILER=smtp`, host, port, username/password, encryption/scheme, and sender domain. Invitations are encrypted queued notifications. Never use the log mailer with real invitation/reset links: log mailers contain the secrets in those links. Set `APP_URL` to the real HTTPS origin before inviting users. Resending an invitation invalidates its earlier secret. Links expire after `CHAT_INVITATION_HOURS` (48 by default) and are single-use.

**Database:** defaults to SQLite for small local installations. For MySQL/PostgreSQL set the usual `DB_*` fields and run migrations. Unique participant pairs, sender/client message IDs, user/call locks, foreign keys and indexes enforce persistence invariants. Use a server database for concurrent production traffic; SQLite serializes writes and may return a retryable busy error under contention.

**Private storage:** `CHAT_DISK=local` stores uploads in `storage/app/private/attachments` using UUID names without user extensions. Do not expose that directory or run `storage:link` for chat files. `CHAT_DISK=s3` uses the installed Flysystem AWS adapter; configure `AWS_ACCESS_KEY_ID`, secret, bucket, region, `AWS_ENDPOINT`, and `AWS_USE_PATH_STYLE_ENDPOINT` for compatible vendors. Block public bucket access. S3 media is streamed through the authorized API, including byte-range reads. Back up both database and files.

**WebRTC / Cloudflare Realtime TURN:** HTTPS (or localhost) is required for microphone/camera access. Laravel generates temporary Cloudflare ICE credentials through authenticated `GET /api/v1/ice-servers`. Set backend-only `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`, and `CLOUDFLARE_TURN_TTL=3600`. The old static/self-hosted `WEBRTC_*` options are no longer used. See [Cloudflare setup and client integration](docs/cloudflare-turn.md). React fetches before outgoing ringing and before incoming acceptance; the native starter includes a tested connection factory that fetches before constructing a native peer. Pusher Channels continues carrying all call signaling.

## Browser, API and mobile authentication

The website uses Fortify's `/login`, `/logout`, `/forgot-password`, and `/reset-password` with Sanctum's session cookies. Same-origin fetch sends the encrypted XSRF cookie in the `X-XSRF-TOKEN` header. APIs require `auth:sanctum`, active accounts, and membership/role authorization. Set `SANCTUM_STATEFUL_DOMAINS` to trusted host:port values (no scheme), `CORS_ALLOWED_ORIGINS` to explicit origins (with scheme), `SESSION_DOMAIN` appropriately, and `SESSION_SECURE_COOKIE=true` in HTTPS production. Use `APP_DEBUG=false`, `SESSION_ENCRYPT=true`, restrictive trusted proxies, and do not cache private API/media responses.

Future native clients use `POST /api/v1/tokens` (email, password, device_name), store the 30-day bearer token in platform secure storage, and send `Authorization: Bearer …`. Revoke using `DELETE /api/v1/tokens/current`. There is no token-based registration. Cookie and bearer clients share account-status checks and resource policies. Forgot/reset routes cannot activate a pending/suspended account. On suspension, all tokens/database sessions are removed and all subsequent API/channel requests are denied. The queued Pusher termination job retries three times. Already subscribed sockets may receive events until termination succeeds; disconnected clients can retain data already downloaded. Pusher user authentication must succeed for immediate socket termination, including future native clients. Monitor failed termination jobs and provider outages. No system can retract a file already downloaded.

Web media URLs use authenticated same-origin cookies. Native players that cannot attach headers should fetch with the bearer token into app-private storage and play a local URI; use a streaming transport supporting headers for large media. Do not put bearer tokens in query strings or persist them in shared caches. This application intentionally does not mint public attachment URLs.

## Implemented behavior

- Admin invitations, pending/active/suspended status, role management, reset emails, protected last-admin transitions, audit entries, profile/avatar updates, secure initial admin command.
- Unique one-to-one conversations, active user search, text/multiple attachments, client UUID idempotency, cursor history, unread/read cursors, transient typing, presence and approximate last seen.
- Optimistic send states and manual retries, own-event deduplication, upload progress/cancellation, downloads, supported image/video/audio previews, full-size image/video viewers, authenticated Range requests and optional queued thumbnails.
- Persisted notification center/read state, explicit browser notification permission, private preview preference, deduplication and suppression for the visible, focused conversation. New messages play a subtle chime (enabled by default after a click/key interaction permits browser audio); Notifications includes a persistent per-browser mute preference and Test sound button. Sounds require Relay to remain open and do not play for history loaded during reconnect.
- Audio/video WebRTC, incoming/outgoing controls, reject/cancel/busy/missed/failed/ended states, duration, local/remote video, microphone/camera toggles, queued early ICE, participant-only signaling, backend transition validation and active-call locks.
- Responsive messenger, search, empty/loading/error/offline/reconnect states, administration metrics/user pagination and recent audit log. Private content is not exposed through admin routes.

“Active” in the dashboard means activated and unsuspended, not currently online. Pending means invitation not yet accepted. Online is an approximate last authenticated activity within 90 seconds; presence channels also trigger list refreshes. Total storage includes persisted attachment rows, including uncommitted uploads until cleanup; avatars are excluded.

## Retention and operational limits

No message-deletion UI/API is exposed. Messages and committed attachments are retained indefinitely by default, including after suspension. Database foreign keys restrict deleting users referenced by conversations. Self-deletion is allowed only for accounts with no conversation history and never for the last active administrator; retained accounts must be suspended instead. Physical deletion under a separately agreed retention policy should remove associated objects and thumbnails; scheduled cleanup removes orphan objects at least 24 hours old after database deletion. It never extracts archives. Define a backup/deletion policy appropriate to your group before launch.

All extensions and unknown file types can be uploaded. Only server-detected JPEG, PNG, GIF, WebP, MP4, WebM, MP3, Ogg and WAV content may be served inline; HTML/SVG and other types are forced downloads with `nosniff` and sandbox headers. Unsupported/corrupt previews fall back to file metadata and download. GD thumbnails skip images over 16 million pixels or unsupported formats; failures do not block messages. There is no malware scanning; integrate a scanner if your deployment needs one.

Defaults: 25 MiB/file, 5 attachments/message and 1 GiB uploaded storage/user. Configure `CHAT_MAX_FILE_KB`, `CHAT_MAX_ATTACHMENTS`, `CHAT_STORAGE_LIMIT_BYTES`. For five 25 MiB files set PHP `upload_max_filesize=25M`, `post_max_size=130M`, `max_file_uploads=20`, suitable execution time/memory, and Nginx `client_max_body_size 130m` (or Apache equivalent). Align reverse proxy/CDN/S3 quotas too. PHP upload errors/413 responses are surfaced; retry retains file selections. Cancelled uploads may complete server-side and are removed by the next abandoned-upload cleanup after 24 hours.

Calls ring for 45 seconds. Accepted calls require a heartbeat from **both** participants every 20 seconds; the older participant heartbeat plus 90 seconds defines the lease. Scheduler/API expiry releases both call locks. Brief network disconnects use browser ICE recovery; failed ICE or lease expiration ends the call. Reloading during an active call cannot restore a peer connection: close/end the restored call and redial. Server state says a browser reported connected, not proof that media was delivered. SDP and ICE are never persisted in message history or queued; do not enable HTTP request body logging on signaling routes.

Connected notifications require an open app. Device registration stores an encrypted optional push token and reports `push_delivery_enabled=false`. FCM/APNs delivery, background mobile incoming calls, CallKit/ConnectionService, and a React Native application are **not** implemented. No closed-app call delivery is claimed.

Pusher pricing and free limits can change: confirm connection, message and event limits in your provider dashboard. A message creates conversation events for two participants plus a recipient notification and a conversation message event; typing is capped at 12/minute, heartbeats use the API, and notification metadata contains no message body. Large message events fall back to IDs; clients refetch. Hosting, database, email, object storage, Pusher and TURN bandwidth may cost money. No perpetual free service is promised.

## Verification and testing

```powershell
php artisan test
php vendor/bin/phpstan analyse
php vendor/bin/pint --test
npm run check
npm run types:check
npm run build
```

The automated suite exercises API/cookie login, account restrictions, invitations (single use, expiry, replacement), admin permissions, suspension/token/session revocation, membership/idempotency/read cursors, pagination, notifications, file limits/ownership/safe headers/ranges, channel policy callbacks, call participation/transitions/overlap/timeouts. Two starter 2FA tests are skipped because two-factor authentication is not enabled. See `docs/verification.md` for actual run results and remaining limitations.

For two-user manual verification, open a normal and a private browser window, log into separate accounts, start a conversation, send text/multiple files and retry after disabling the network. Verify sender echo deduplication, recipient notification, unread/read indicators and recovery after reconnect. Seek in a video and try downloading the URL while logged out or as a third user. Test suspension from an admin session while the other session is connected. For calls, explicitly accept microphone permissions and test audio-only then video, mute/camera/hangup, rejection, cancellation, busy and timeout. Repeat using two physical devices on different networks with TURN and verify media in both directions. Actual media connectivity cannot be established by API tests alone.

API and event contracts: [docs/api.md](docs/api.md).

Video calls require a working microphone, but the camera is optional. Camera absence, permission denial, a busy camera or allocation failure continues with audio and a blank local video placeholder. Remote video can still be received. The camera button is disabled when no camera track is available. Microphone failure blocks call setup with an actionable message. `npm run test:call-media` verifies acquisition fallback and cancellation using simulated devices; it does not verify actual WebRTC media connectivity.

Call audio uses a dedicated remote audio player with an Enable call audio button if browser autoplay is blocked; video previews stay muted to avoid duplicate playback. Remote tracks are aggregated and incoming signaling is processed in order. The timer starts from WebRTC media/ICE connection, uses the server timestamp when available, and freezes on hang-up. Outgoing calls play locally synthesized ringback until acceptance or termination. `npm run test:call-ringback` verifies tone lifecycle with simulated audio nodes. Verify actual two-way audio and ringback between separate devices; acceptance alone does not confirm a media connection.

Hang-up stops local media immediately, disables repeated submissions and briefly shows Ending call before closing after server confirmation. Failed synchronization leaves media off and offers Retry hang-up; the call lease still provides eventual cleanup if the server cannot be reached. Late signals/heartbeats cannot reopen a locally ended or dismissed call. Repeated terminal cleanup requests return the existing history record without duplicate events.

Idle-tab recovery: returning to a tab, restoring the network or the periodic foreground check validates the session, reconnects stale/unavailable Pusher connections, retries failed subscriptions and reconciles missed API state. Wake events share a single session check with a five-second cooldown. Transient connection notices clear after recovery; they are separate from message/upload errors. Expired or disabled accounts stop recovery and show Sign in instead of repeatedly reconnecting. `npm run test:realtime-recovery` tests simulated sleep, network recovery, subscription retry, expiry, event coalescing and cleanup. These tests do not simulate real OS sleep or prove delivery over a live interrupted WebSocket.

User management: Administration → Create user requires name, email, role and a confirmed password of at least 8 characters. Accounts are active immediately. Edit lets admins assign a new confirmed password; leaving it blank preserves the password. Assigning a password revokes that account’s sessions/tokens. Profile settings → Change password requires the current password and retains only the current device’s session/token.

Delete permanently requires typing the account email and removes the account plus its shared conversations/messages/attachments for both participants. The UI states this consequence. Self-deletion and removal of the last active admin are blocked. Storage objects and thumbnails are deleted by the retryable `DeleteAccountFiles` queue job after database commit; keep the queue worker running. Deletion updates are broadcast to remaining participants. Audit records remain with a null deleted subject reference.

Chat history opens at the latest message. Scrolling upward automatically requests older cursor pages and preserves the visible position while prepending. New messages follow the bottom only while you are near the latest messages; sending your own message returns to the latest. The native inverted list supports the same behavior.


Call/notification sound update: incoming web calls use a louder repeating double ring, outgoing ringback is louder, and message/missed-call chimes use increased gain. Browser interaction unlocks audio; an incoming call shows Enable incoming ringtone if playback is blocked. Ringtones stop on acceptance, rejection, cancellation, expiry and cleanup. Device volume and browser autoplay controls still apply. Automated tests cover incoming tone scheduling, immediate stop and stopping while audio unlock is pending; audible output needs a device check.
