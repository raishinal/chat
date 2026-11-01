# API v1 and realtime contract

Base URL: `{APP_URL}/api/v1`. All timestamps are UTC ISO 8601 (`…Z`). IDs are JSON integers; treat them as opaque identifiers in native clients. Always send `Accept: application/json`. Request and response property names use snake_case. File contents are transferred over authenticated HTTP only.

## Authentication and errors

Web: `GET /sanctum/csrf-cookie`, `POST /login` with email/password, then use session cookies and `X-XSRF-TOKEN` for mutations. `POST /logout` ends the web session. `GET /login`, `/forgot-password`, `/reset-password/{token}` and `/invitations/{invitation}?token=…` render React screens. Public registration is unavailable (404).

Native: `POST /tokens` accepts `{email,password,device_name}` and returns `{token,user}`. Send the bearer token on all protected requests, including Pusher authorization. It expires after 30 days. `DELETE /tokens/current` revokes only the presented token (204). Cookie clients use web logout. `GET /me` returns `{data: User}`.

`POST /forgot-password` accepts `{email}` and returns a generic eligibility message. Native clients complete reset using `POST /api/v1/reset-password` (minimum 8 characters); the website uses Fortify `POST /reset-password` with `{email,token,password,password_confirmation}` and `Accept: application/json`; native callers do not need a session cookie. `POST /invitations/{invitation}/accept` accepts `{token,password,password_confirmation}` (password at least 8 characters) and returns an activation message; used/expired/replaced links return 410.

Errors use Laravel JSON `{message,errors?:{field:[message,…]}}`: 401 unauthenticated; 403 role/membership/inactive account forbidden; 404 absent or not owned; 409 duplicate client ID in another conversation, busy or invalid call transition; 410 expired invitation; 413 proxy/PHP request too large; 416 invalid Range (with `Content-Range: bytes */size`); 419 CSRF/session expired; 422 validation/quota; 429 rate limit; 503 service unavailable. Retry idempotent sends with the **same** client UUID; use a fresh UUID for genuinely new messages. Generic reverse-proxy errors may not be JSON.

## Resource schemas

```typescript
User = {
 id: number; name: string; role: 'admin'|'user';
 status: 'pending'|'active'|'suspended'; last_seen_at: string|null;
 online: boolean; avatar_url: string|null;
}
Attachment = {
 id: number; name: string; mime: string; size: number; previewable: boolean;
 url: string; download_url: string; thumbnail_url: string|null;
}
Message = {
 id: number; conversation_id: number; sender_id: number; client_id: string;
 body: string|null; created_at: string; attachments: Attachment[];
 edited_at: string|null; deleted_at: string|null;
}
Conversation = {
 id: number; peer: User; unread_count: number; read_id: number;
 peer_read_id: number; latest_message: Message|null; updated_at: string;
}
Call = {
 id: number; conversation_id: number; caller_id: number; callee_id: number;
 kind: 'audio'|'video'; status: 'ringing'|'accepted'|'connected'|'rejected'|
 'cancelled'|'busy'|'missed'|'timeout'|'failed'|'ended';
 connected_at: string|null; ended_at: string|null; expires_at: string;
 caller_seen_at: string|null; callee_seen_at: string|null;
 created_at: string; updated_at: string;
}
Notification = {
 id: number; user_id: number; kind: 'message'|'incoming_call'|'missed_call';
 data: {conversation_id: number; message_id?: number; call_id?: number; sender_name?: string};
 read_at: string|null; created_at: string; updated_at: string;
}
```

Admin user rows additionally expose email, created_at and updated_at; hidden authentication secrets are never returned. The ordinary user directory omits email. The admin endpoint does not expose messages/conversations/files.

## Endpoint specification

All routes below require an active authenticated account unless explicitly identified above. `{id}` in a URL must refer to an authorized resource. Every conversation operation requires membership; uploads/sends/typing/signals also require both participants active.

| Method and path                                  | Request                                                       | Response                                                              |
| ------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET `/users`                                     | `q?`, `page?`                                                 | User page, active users except self, 20/page                          |
| POST `/profile`                                  | multipart `name`, `avatar?` (JPEG/PNG/WebP, ≤2 MiB)           | `{data: User}`                                                        |
| GET `/users/{user}/avatar`                       | cookie/bearer, Range optional                                 | private image stream                                                  |
| GET `/conversations`                             | `q?` peer-name search, `page?`                                | Conversation page, 30/page                                            |
| POST `/conversations`                            | `{user_id}`                                                   | `{data: Conversation}`; existing unordered pair reused                |
| GET `/conversations/{conversation}`              | —                                                             | `{data: Conversation}`                                                |
| GET `/conversations/{conversation}/messages`     | `cursor?`, `after_id?`                                        | Message cursor page, 40/page                                          |
| POST `/conversations/{conversation}/messages`    | `{client_id: UUID, body?: string, attachment_ids?: number[]}` | `{data: Message}`, 201 new / 200 retry                                |
| POST `/conversations/{conversation}/read`        | `{message_id}`                                                | 204; monotonically advances own read cursor                           |
| POST `/conversations/{conversation}/typing`      | `{}`                                                          | 204; capped at 12/min                                                 |
| POST `/conversations/{conversation}/attachments` | multipart `files[]`                                           | `{data: Attachment[]}`; staged, unattached upload                     |
| GET `/attachments/{attachment}`                  | `download=1?`, `thumbnail=1?`; Range optional                 | authenticated stream, 200/206/416                                     |
| GET `/notifications`                             | `cursor?`                                                     | Notification cursor page, 30/page                                     |
| PATCH `/notifications/{notification}/read`       | `{}`                                                          | 204; recipient only                                                   |
| GET `/calls`                                     | `cursor?`                                                     | Own call-history cursor page, 30/page                                 |
| POST `/conversations/{conversation}/calls`       | `{kind:'audio'                                                | 'video'}`                                                             | `{data: Call}`, 201; busy 409 includes `{message,call}` |
| PATCH `/calls/{call}`                            | `{action}` (see transitions)                                  | `{data: Call}`                                                        |
| POST `/calls/{call}/signal`                      | `{type:'offer'                                                | 'answer'                                                              | 'ice',payload: object}`                                 | 204, synchronous delivery           |
| GET `/ice-servers`                               | —                                                             | `{ice_servers: RTCIceServer[],expires_in:number,expires_at:string}`   |
| POST `/broadcasting/auth`                        | `{socket_id,channel_name}`                                    | Pusher authorization JSON                                             |
| POST `/pusher/user-auth`                         | `{socket_id}`                                                 | Pusher authenticated-user JSON                                        |
| PUT `/devices`                                   | `{device_id: UUID,platform:'web'                              | 'ios'                                                                 | 'android',push_token?:string}`                          | 201 `{push_delivery_enabled:false}` |
| GET `/admin/users`                               | `q?`, `page?`                                                 | `{metrics:{total,active,pending,suspended,storage_bytes},users:page}` |
| POST `/admin/users`                              | `{name,email,role,password,password_confirmation,status?}`    | 201 active user; password at least 8 characters, no invitation        |
| PATCH `/admin/users/{user}`                      | `{name,email,role,status?,password?,password_confirmation?}`  | Updated user; optional password revokes sessions/tokens               |
| DELETE `/admin/users/{user}`                     | `{confirmation: account email}`                               | 204; account and shared chat history removed, file cleanup queued     |
| POST `/admin/users/{user}/reset-password`        | `{}`                                                          | 204; active users only                                                |
| GET `/admin/audit`                               | `page?`                                                       | audit page, 30/page                                                   |

Admin routes require the admin role. Creation assigns a confirmed password and activates immediately. Password edits revoke that user’s tokens/sessions. Legacy pending accounts require a password before activation. Admins cannot suspend/delete themselves or demote/suspend/delete the last active admin. Permanent deletion removes shared conversations and files for both participants; file deletion runs after commit through the queue. Audit subject references become null after deletion.

Messages need text, at least one attachment, or both. Body limit 4000 characters; message attachment count defaults to five. Each uploaded file can be up to 1 GiB (1,073,741,824 bytes), configured by `CHAT_MAX_FILE_KB=1048576`. The separate total storage quota defaults to 1 GiB per user (`CHAT_STORAGE_LIMIT_BYTES`), so existing uploads reduce available space. Only uploads staged by the sender in the same conversation can be claimed. Once claimed they cannot be reused for a new message. A successful retry returns the existing resource, without creating another notification or broadcast. Original filenames are display-only.

Resource pages use `{data,links:{first,last,prev,next},meta}`. Message cursor pages include `meta.next_cursor`. Raw call/notification cursor pages use `{data,next_cursor,next_page_url,prev_cursor,prev_page_url,per_page,path}`. Treat returned cursor strings/URLs as opaque. Message history defaults to descending ID; reverse a page for display. Supplying `after_id>0` returns ascending IDs greater than that value; follow all next links after a reconnect to bridge arbitrarily long gaps. Re-fetch conversations and notifications to reconcile unread state. Read a conversation's actual message ID, never a global guessed ID.

## Channels and events

Logical Laravel/Echo channels:

- `v1.users.{user_id}` → Pusher `private-v1.users.{user_id}`; that active user only.
- `v1.conversations.{conversation_id}` → `private-v1.conversations.{conversation_id}`; active members only.
- `v1.presence` → `presence-v1.presence`; active accounts; member info `{id,name}`.

Use the same authorization endpoints for `@pusher/pusher-websocket-react-native`. Authenticate the Pusher user too, using `/pusher/user-auth`, to enable forced disconnect on suspension. Never use unauthenticated public signaling channels or client-generated Pusher events.

Every event has `{version:1,event:string,occurred_at:string,data:object}`. Laravel Echo listeners use a leading dot (`.v1.message.created`) to avoid namespace expansion; native clients bind the literal event name.

| Event                     | Channel            | `data`                                                                                                            |
| ------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `v1.message.created`      | conversation       | canonical Message, or `{id,conversation_id}` if serialized payload exceeds 7500 bytes; refetch on reduced payload |
| `v1.message.read`         | conversation       | `{conversation_id,user_id,message_id}`                                                                            |
| `v1.typing`               | conversation       | `{conversation_id,user_id,expires_at}`; expires after 8 sec                                                       |
| `v1.conversation.updated` | both private users | `{conversation_id}`; refetch canonical resource                                                                   |
| `v1.notification.created` | recipient user     | Notification                                                                                                      |
| `v1.call.updated`         | both participants  | Call; initial ringing means incoming/outgoing                                                                     |
| `v1.call.signal`          | remote user        | `{call_id,type,signal_id,index,total,chunk}`                                                                      |

Signal chunks are base64 pieces of UTF-8 JSON, max 6000 ASCII characters each. Group by signal_id; order by zero-based index; concatenate; base64-decode; UTF-8 decode; JSON-parse. Expire incomplete groups after 30 seconds. SDP payload: `{type:'offer'|'answer',sdp:string}` (max 24000 characters). ICE payload: `{candidate,sdpMid?,sdpMLineIndex?,usernameFragment?}` (candidate max 4000 characters). Offer only from caller, answer only from callee; only accepted/connected, unexpired calls can signal. Candidate messages may precede descriptions: buffer until `setRemoteDescription` succeeds. Attachments in events contain metadata/HTTP URLs only, never bytes. Deduplicate messages by client_id and notifications by id.

## Call transitions and recovery

`ringing → accepted` or `rejected` (callee); `ringing → cancelled` (caller); either participant may end/fail an active call. `accepted → connected` is reported by the browser after peer connection state becomes connected; repeating connected is allowed. `heartbeat` is valid only for accepted/connected calls and does not broadcast. Terminal calls reject non-terminal mutations (409). Repeated end/cancel/reject/failed cleanup requests return the existing terminal Call without rewriting history or rebroadcasting, so simultaneous hang-ups and network retries are safe. Overlapping active calls return busy (409); a unique active_calls row per user plus locked users prevents double acquisition. Ring expiry becomes missed; accepted/connected lease expiry becomes timeout. Both paths persist terminal status, remove locks, broadcast state and notify missed calls.

The web client sends a heartbeat every 20 seconds. The lease is the **older participant's** last heartbeat + 90 seconds. Reconnect fetches current calls; an interrupted peer connection is not restored across page reload, so end and redial. Do not replay SDP/ICE after a terminal state. If signaling fails, stop all media tracks and attempt a failed/end mutation; the lease guarantees eventual server cleanup even if the request cannot reach the backend.

## Mobile extension boundary

Device registration is an integration contract, not a working push service. The Notifier service is the single persistence/live-event boundary where an FCM/APNs adapter can later be added. Native push token values are encrypted at rest. Closed-app calls require platform push + native call integration and are outside this delivery. Downloads/media must retain authenticated transport; do not put bearer credentials in public URLs. REST contracts do not rely on Inertia props or browser-generated HTML.

## Sources for integration setup

[Laravel Sanctum](https://laravel.com/framework/docs/13.x/sanctum) documents first-party session versus native bearer authentication. [Pusher user authentication](https://pusher.com/docs/channels/server_api/authenticating-users/) explains authenticated users and connection termination. Use installed package APIs and lockfiles as the code's version reference.

### Cloudflare connectivity credentials

`GET /api/v1/ice-servers` uses the same active-account Sanctum cookie/bearer authentication as calls. It permits 10 requests/minute/account and returns `Cache-Control: private, no-store, max-age=0`. Each successful request generates new short-lived Cloudflare STUN/TURN configuration. `expires_in` is the server-configured TTL (default 3600 seconds, clamped to 60..86400); `expires_at` is a conservative UTC expiry based on the issuance request start. Clients cannot select TTL or provider keys. Missing configuration, timeout, upstream failure or malformed provider responses return sanitized 503 errors; do not silently continue with STUN-only connectivity. Temporary credentials remain in memory, outside Pusher events, logs and persistent client storage. Fetch for both outgoing initiation and incoming acceptance, before constructing `RTCPeerConnection`. [Setup and native helper](cloudflare-turn.md).

`PUT /api/v1/profile/password` requires `{current_password,password,password_confirmation}` and active authentication. Passwords must be different and at least 8 characters. Returns `{message}`; retains the current bearer token or browser session, revokes others and invalidates reset links. Limited to six attempts per account per minute.

### Message editing and deletion

`PATCH /messages/{message}` accepts `{body: string|null}` (4000 characters maximum). Only the sender may edit; text may be cleared when attachments remain. Returns `{data: Message}` with `edited_at`. Editing a deleted message returns 409.

`DELETE /messages/{message}` is sender-only and returns `{data: Message}`. Text and attachments are removed for both participants. The message ID/client ID remain as a tombstone with `deleted_at`, null body and empty attachments, preserving pagination, read cursors and send retry safety. Repeated deletion succeeds.

`DELETE /attachments/{attachment}` is uploader-only, works for staged and sent files, and returns 204. The original file and thumbnail are queued for deletion after commit; authenticated downloads immediately return 404. Removing the final attachment of a message without text marks the empty message deleted.

`Message` includes nullable ISO timestamps `edited_at` and `deleted_at`. `v1.message.updated` broadcasts `{id,conversation_id}` on the conversation channel for edits, message deletion and sent-file deletion; both users also receive `v1.conversation.updated`. Refetch the loaded history on this event and after reconnect/polling to reconcile changes to older messages, including tombstones.
