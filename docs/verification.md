# Verification — 31 October 2026

- Pest: 72 passing tests, 2 skipped starter 2FA tests (2FA is disabled).
- PHPStan: configured level 7, no errors.
- Pint: formatting check passes.
- Frontend formatter and lint: passes.
- TypeScript: passes (`tsc --noEmit`).
- Production frontend build: passes.
- Configured local database migrations: applied successfully.
- `python scripts/http_smoke.py`: passes with two independent real HTTP cookie jars, CSRF-protected login, conversations, message creation/idempotency, recipient history/notification visibility, read receipts, an unknown-format multipart upload, authorized byte-range download, and call accept/end state. Uses a separate randomly named SQLite database, deletes its uploaded files/database on completion, and does not modify configured user accounts.

The Windows sandbox cannot read some Composer files through PHP's is_readable checks and blocks loopback sockets. PHP tests/static checks and the HTTP smoke test ran with elevated filesystem/network access. TypeScript/build checks ran normally.

Pusher network delivery/presence, actual mail delivery, private S3 storage, browser permission/notification behavior, visual browser interactions, and cross-network TURN/media were not exercised. Call API tests verify state/authorization only. **No actual microphone/camera media connection was tested.** Configure the external services and follow the two-browser/device procedure in README.md before production use. No claim of closed-app mobile call support is made. React Native was not built.

The build reports the starter's optional Fontaine font-fallback optimization warning; it does not prevent the build or require another runtime dependency.

## Cloudflare Realtime TURN update

17 additional backend cases fake Cloudflare credential generation and verify access/status restrictions, bearer clients, temporary credentials, expiry/TTL policy, sanitized failures and issuance throttling. The native connection helper passes four Node tests and an isolated strict TypeScript check. Web TypeScript, lint and production build pass; PHPStan level 7 and Pint pass.

The native repository remains a starter with no call screens or react-native-webrtc module. The new helper is ready for its future outgoing/incoming calling flow. Full native TypeScript checking encounters existing errors in animated-icon.web.tsx (CSS module declaration), app-tabs.web.tsx (ref typing), and theme.ts (CSS side-effect declaration). `npm run lint` could not complete because this starter has no ESLint config/dependencies; Expo tried installing them with networking disabled. That attempted tooling change was reverted. No unrelated native UI files or dependencies were changed.

No real Cloudflare key/token was supplied to tests and no actual Cloudflare relay/media connection was verified. See cloudflare-turn.md for deployment and cross-network testing.

Account management and history update: web lint/format, TypeScript and production build pass. Native lint/TypeScript and the existing 54 tests pass. Added self-service password changes, direct admin creation with passwords, optional admin password editing, email-confirmed permanent deletion and automatic scroll-up history pagination. No real account was deleted or password changed during verification. Added/updated backend feature tests in ChangePasswordTest, AdminManagementTest and ChatApiTest; final execution, PHPStan and Pint verification are pending because automatic approval review failed at its usage limit. The initial password test run passed seven cases and exposed a browser-session fixture failure; that fixture and Sanctum guard refresh were corrected but could not be re-run. Test these features with isolated accounts before deployment, including self-service browser session retention, deletion file jobs and real device scroll anchoring. Earlier starter-only native notes are historical; the adjacent native app now includes these screens.
