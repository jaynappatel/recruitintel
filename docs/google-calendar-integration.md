# Google Calendar integration setup

This is the manual developer/operations setup for RecruitIntel's Milestone 5 one-way Calendar
integration. Do not put client secrets, refresh tokens, or encryption keys in source control.

## 1. Create or select a Google Cloud project

Open Google Cloud Console, create or select the project that will own RecruitIntel's OAuth client,
and record the project name for operational ownership.

## 2. Enable the Google Calendar API

In **APIs & Services → Library**, find **Google Calendar API** and enable it for the project.

## 3. Configure the OAuth consent screen

Configure the app name, support email, developer contact, audience, authorized/verified domains,
privacy policy, and terms links as appropriate. While the app is in testing, add each Google account
that will connect as a test user. Production apps may require Google's OAuth verification.

## 4. Create the OAuth client

In **Google Auth Platform → Clients**, create a **Web application** client. RecruitIntel uses the
supported server-side authorization-code flow; do not create a browser-only client or use an
embedded user-agent.

## 5. Add the authorized redirect URI

The redirect must exactly match `GOOGLE_REDIRECT_URI`, including scheme, hostname, port, path, and
trailing-slash behavior. The callback path is:

```text
/api/integrations/google-calendar/callback
```

## 6. Configure required environment variables

```dotenv
DATABASE_URL=postgresql://...
RECRUITINTEL_APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=replace-with-web-client-id
GOOGLE_CLIENT_SECRET=replace-with-web-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google-calendar/callback
CALENDAR_TOKEN_ENCRYPTION_KEY=replace-with-32-random-bytes-base64url
```

The authenticated session is the only source of Calendar ownership. The web API binds queued work
to that user in PostgreSQL; the Calendar-lane typed worker receives only an orchestration reference
to the owner-bound domain request and verifies the request/connection owner relationship in its
database join. `RECRUITINTEL_APP_URL` is used only to build a safe link in event descriptions.

The Calendar OAuth client must be separate from the sign-in client configured by
`AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. Calendar grants and authentication grants
must never be conflated.

## 7. Requested scopes

RecruitIntel requests:

```text
openid
email
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.owned
```

`openid email` identifies the connected account without reading profile content.
`calendar.calendarlist.readonly` identifies selectable target calendars without changing the list.
`calendar.events.owned` is narrower than full Calendar access and permits V1 create/update/delete on
calendars the user owns. RecruitIntel does not request full calendar access or a read scope for all
events. See Google's current [Calendar scope reference](https://developers.google.com/workspace/calendar/api/auth).

If a user withholds a required Calendar scope, callback processing returns
`GOOGLE_SCOPE_NOT_GRANTED` and does not save a usable connection.

## 8. Local callback

Google permits localhost HTTP for development. Register and configure exactly:

```text
http://localhost:3000/api/integrations/google-calendar/callback
```

Start the web app at that origin, call GET
`/api/integrations/google-calendar/authorize`, and navigate the browser to the returned URL.

## 9. Production callback

Use a domain you control and HTTPS, for example:

```text
https://recruitintel.example/api/integrations/google-calendar/callback
```

Register the exact URI in the Google client and set `GOOGLE_REDIRECT_URI` to the same value.
Production OAuth configuration also needs a public home page, privacy policy, terms, and verified
domain as required by [Google's OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies).

## 10. Configure token encryption

Generate 32 random bytes and encode them as base64url (or use 64 hexadecimal characters). One local
option is:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Store the value in a secrets manager and expose it as `CALENDAR_TOKEN_ENCRYPTION_KEY` to both the
web process and calendar worker. The implementation uses AES-256-GCM with a random nonce,
authenticated versioned envelope, and fixed context. Never rotate by simply replacing the key while
connections exist: a future rotation operation must decrypt with the old key and re-encrypt with the
new key. The current envelope version makes that migration possible without a schema redesign.

Access tokens are memory-only. Refresh credentials are encrypted before database storage and are
never returned to the browser or written to logs.

## 11. Troubleshooting

- `GOOGLE_OAUTH_NOT_CONFIGURED`: set client ID, client secret, and redirect URI in the web process.
- `INVALID_GOOGLE_REDIRECT_URI` or `redirect_uri_mismatch`: compare the environment value and Google
  client entry byte-for-byte. Non-local callbacks must use HTTPS.
- `INVALID_OAUTH_STATE`: the state expired after ten minutes, was already consumed, was tampered
  with, or was issued for another attempt. Start authorization again.
- `GOOGLE_TOKEN_EXCHANGE_FAILED`: the code expired/was reused or the client configuration differs.
  Start again; do not copy authorization codes into logs or support tickets.
- `GOOGLE_SCOPE_NOT_GRANTED`: reconnect and grant all requested Calendar permissions.
- Connection is `REAUTH_REQUIRED`: Google rejected the refresh credential (revocation, expiration,
  password/security event, or session policy). Reconnect through the authorize endpoint.
- Request remains `PENDING`: verify the Calendar worker lane is running, its database role is bound
  to `CALENDAR`, and the Google provider policy is reviewed/executable. HTTP routes intentionally do
  not spawn provider work.
- Provider returns 403: quota/rate-limit reasons become retryable durable work and honor
  `Retry-After`; authorization/scope reasons transition to `REAUTH_REQUIRED`. Confirm the Calendar
  API is enabled, required scope is granted, and the selected calendar is owned by the account.
- All-day item appears shifted: verify `startsOn`, `allDay`, and IANA `timezone`; do not replace the
  date with a browser-generated UTC timestamp.

## 12. Reauthorization and disconnection

Google documents that refresh tokens can be revoked or otherwise become invalid. The worker treats
`invalid_grant` and provider authorization failures as non-retryable, records a sanitized code, and
sets `REAUTH_REQUIRED`. It does not crash-loop. The user must explicitly start a new authorization
flow. See Google's [web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server).

Disconnect performs a best-effort call to Google's revocation endpoint, then clears the local
encrypted credential and unconsumed OAuth state even if the network revoke cannot complete. External
event mappings remain as audit/idempotency records; V1 does not delete the user's already-created
Google events merely because the account connection is disconnected.

## Security notes

- OAuth state is 256 random bits, stored only as SHA-256, expires in ten minutes, and is consumed
  atomically once. The callback also requires the initiating RecruitIntel session and rejects state
  issued for another user.
- PKCE S256 is used in addition to the confidential web-client secret.
- Callback redirects use the configured redirect origin and a database-constrained relative path,
  preventing an arbitrary return URL.
- Browser responses never contain credentials. Token response metadata explicitly excludes access
  and ID token values.
- Calendar descriptions are control-character stripped, bounded, and composed only from normalized
  fields and selected provenance URLs. Raw scraped content is never copied into Google events.
- The provider boundary can adopt stronger token binding such as DPoP later; token metadata records
  the current bearer binding without coupling the domain schema to Google-specific token fields.
