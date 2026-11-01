# Cloudflare Realtime TURN

Cloudflare supplies STUN/TURN connectivity. Pusher Channels remains the SDP/ICE signaling transport; this does not introduce Cloudflare SFU or RealtimeKit.

## Obtain backend credentials

1. Sign in to the [Cloudflare Realtime dashboard](https://dash.cloudflare.com/?to=/:account/calls) and select your account. Open TURN Service and create a TURN key. Use the dashboard link in Cloudflare's [Generate Credentials guide](https://developers.cloudflare.com/realtime/turn/generate-credentials/) if the dashboard navigation changes.
2. Copy the TURN **key ID** and its associated **TURN key API token** into the Laravel server environment. This is the token paired with the TURN key for the `rtc.live.cloudflare.com` API, not a browser API key or the account Global API Key. Store the token securely when generated. If needed, create a replacement key/token and rotate the server environment.
3. Configure the following only on Laravel (or in its deployment secret manager):

```dotenv
CLOUDFLARE_TURN_KEY_ID=your-turn-key-id
CLOUDFLARE_TURN_API_TOKEN=your-turn-key-api-token
CLOUDFLARE_TURN_TTL=3600
```

Never use `VITE_` or `EXPO_PUBLIC_` prefixes for Cloudflare credentials. Never put them in React/native source, app.json, browser storage, client bundles, Pusher events, or logs. No Cloudflare account ID is needed at runtime: the generation API uses the TURN key ID. Account API credentials needed to manage keys are a separate provisioning concern; see Cloudflare's [create-key API](https://developers.cloudflare.com/api/resources/calls/subresources/turn/methods/create/).

After changing server configuration, run `php artisan config:clear` locally or regenerate cached configuration with `php artisan config:cache` in production. No frontend rebuild is needed for TURN key rotation. The API returns a clear 503 until configured. The previous self-hosted/static `WEBRTC_*` environment settings are removed.

## Backend flow

An authenticated active account requests `GET /api/v1/ice-servers`. Laravel sends a bounded HTTPS POST to:

```text
https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers
Authorization: Bearer {permanent TURN key API token}
Content-Type: application/json

{"ttl":3600}
```

Cloudflare returns `iceServers`. Laravel validates that STUN/TURN URLs and temporary TURN username/password are present, whitelists output, and adapts it to the existing API contract:

```json
{
    "ice_servers": [
        { "urls": ["stun:stun.cloudflare.com:3478"] },
        {
            "urls": ["turns:turn.cloudflare.com:443?transport=tcp"],
            "username": "temporary-user",
            "credential": "temporary-password"
        }
    ],
    "expires_in": 3600,
    "expires_at": "2026-10-31T12:00:00.000000Z"
}
```

The URL list above is illustrative: clients use all URLs actually returned by Cloudflare. HTTP uses a 3-second connection and 10-second response timeout, no redirects and no automatic retries for credential creation. Provider errors/bodies are not relayed or logged. Responses cannot be publicly cached. Issuance is capped at 10 requests/minute/account in addition to the normal API rate limit. No permanent Cloudflare secret is sent to clients; temporary TURN username/password necessarily reach WebRTC.

TTL is seconds, defaults to one hour, and is bounded by this application's policy to 60..86400. Pick a TTL exceeding your longest expected call, as [Cloudflare recommends](https://developers.cloudflare.com/realtime/turn/generate-credentials/). Current clients fetch fresh credentials for each new peer; they do not automatically refresh an ongoing call's configuration. For calls longer than TTL, add an authenticated refresh before expiry and apply it with `setConfiguration()` (and ICE restart when necessary). Do not reuse expired credentials when redialing. Credential expiry is separate from the application's 90-second participant heartbeat lease. Suspension blocks new issuance; previously issued TURN credentials can remain valid until expiry. Rotate/revoke credentials through Cloudflare when immediate provider-level revocation is required.

## React website

`resources/js/hooks/use-chat-call.ts` fetches via the generated Wayfinder `ice()` route with same-origin cookie authentication. Outgoing calls fetch before creating/ringing the server call. Incoming calls prefetch while ringing and reuse the request on acceptance for the same call for up to 10 seconds; older or failed requests are refreshed. Microphone/camera access still waits for acceptance and successful credential loading. Call teardown clears the prefetched credentials. Failure stops setup and displays the existing recoverable error. Pusher still handles offers, answers, candidates and call transitions.

## React Native starter

The adjacent `chat-app-native` repository has no chat login/call screens and does not yet install `react-native-webrtc`. This change adds `src/lib/call-connectivity.ts`, a dependency-free, tested native call entry point. It fetches using the user's Sanctum bearer token and invokes a supplied native peer factory only after the request succeeds. Use it for **both** outgoing and incoming calls when those screens are built:

```typescript
import { RTCPeerConnection } from 'react-native-webrtc';
import { createCallPeerConnection } from '@/lib/call-connectivity';

const peer = await createCallPeerConnection(
    { apiOrigin, accessToken, signal: abortController.signal },
    (configuration) => new RTCPeerConnection(configuration),
);
```

Pass the Laravel HTTPS origin and retrieve the user's access token from secure storage at call time; no Cloudflare credentials belong in native env. The constructor is injected so this integration does not silently build the previously deferred mobile app or add native modules. A future `react-native-webrtc` integration requires an Expo development build, not Expo Go. Keep authenticated Pusher subscriptions/signaling as documented in api.md. The helper does not implement native background incoming calls.

## Verification

Backend feature tests fake Cloudflare and cover authentication, active status, cookie/bearer use, response shape/secret filtering, no-cache headers, TTL bounds, upstream errors/malformed responses/timeouts and rate limiting. Native `npm run test:connectivity` verifies authenticated fetch precedes peer construction and failure/expiry/cancellation prevents construction. Actual Cloudflare credentials are not bundled or used by tests. Verify real media using two authenticated devices on different networks, then force `iceTransportPolicy: 'relay'` temporarily in a local diagnostic build and confirm a relay candidate pair. Remove the diagnostic override afterwards. Actual Cloudflare relay/media is not verified by mocked tests; check current Cloudflare usage and bandwidth pricing before deployment.
