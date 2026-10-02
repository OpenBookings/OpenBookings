# Consent log — design

**Date:** 2 October 2026
**Closes:** audit D3 (consent evidence)
**Status:** approved, not yet implemented

## Goal

Be able to show, for any visitor, which consent decision they made, for which
categories, under which banner wording, and when. The device stays the source
of truth for gating; the server holds the evidence.

## Decisions (from Wouter)

- `consent_log` is an append-only event table.
- No IP address is stored.
- The device decides whether analytics runs. The server record never gates.
- The client writes through an outbox with retry and idempotency keys.
- The endpoint is public, rate-limited and schema-validated.
- `user_id` is linked on login.

## Data model

Migration `packages/db/drizzle/0018_consent_log.sql` (hand-applied, idempotent)
and a matching Drizzle table in `packages/db/src/schema.ts`.

```sql
CREATE TABLE IF NOT EXISTS consent_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id      uuid        NOT NULL,
  event_type      text        NOT NULL CHECK (event_type IN ('granted','denied','withdrawn','linked')),
  categories      jsonb       NOT NULL,
  banner_version  text        NOT NULL,
  app             text        NOT NULL CHECK (app IN ('web','business')),
  user_id         text        NULL,
  idempotency_key uuid        NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_log_consent_id_idx ON consent_log (consent_id, created_at);
CREATE INDEX IF NOT EXISTS consent_log_user_id_idx ON consent_log (user_id) WHERE user_id IS NOT NULL;
```

- `consent_id` — random UUID generated on the device at the first decision. It
  identifies the device's consent record, not a person.
- `categories` — which kinds of optional storage the visitor agreed to. The
  banner asks one question today (analytics cookies and session recording,
  i.e. PostHog), so the value is `{ "analytics": true | false }`. If a second
  kind is ever added (marketing, say), it becomes a second key and the banner
  version is bumped. Essential storage needs no consent and is not recorded.
- `banner_version` — `<CONSENT_VERSION>+<privacy document id>`, for example
  `2+privacy@2026-10-02/en`, so the row names both the banner and the policy
  wording and language shown. The document id comes from the existing
  `documentVersionId()` in `apps/web/lib/legal/documents.ts`.
- `expires_at` and `created_at` — set by the server. The client's clock is not
  trusted. `expires_at = now() + 90 days`, matching the current TTL.
- `user_id` — no foreign key. The log must outlive account deletion as
  evidence; on erasure the column is nulled, the row stays.
- Append-only: the application role gets `INSERT` and `SELECT`. The only
  update ever issued is nulling `user_id` during erasure.
- `app` is an addition to the list Wouter gave: the banner runs in both apps
  and the evidence should say which one.

## Events

| Event | When |
|---|---|
| `granted` | Visitor accepts. |
| `denied` | Visitor declines. |
| `withdrawn` | Visitor changes an earlier `granted` to off. |
| `linked` | A signed-in user id is first seen with this `consent_id`. Carries the current categories. |

## Endpoint

`POST /api/consent` in `apps/web` and in `apps/business` (same handler, shared
from `packages/analytics/src/consent-route.ts`; each app is its own origin so
each needs the route).

Request body, validated with zod, unknown keys rejected:

```ts
{
  consentId: uuid,
  eventType: 'granted' | 'denied' | 'withdrawn' | 'linked',
  categories: { analytics: boolean },
  bannerVersion: string (max 100),
  idempotencyKey: uuid
}
```

- `user_id` is never accepted from the body. It is read from the server
  session, if there is one. A `linked` event without a session is rejected.
- Insert with `ON CONFLICT (idempotency_key) DO NOTHING`; a repeat returns 200
  with the same shape as the first.
- Response: `{ ok: true, expiresAt }`.
- Body size capped at 2 KB. `Content-Type: application/json` required.
  Same-origin only (checks `Origin`).
- Rate limiting is done in Cloudflare, not in the application: a rate limiting
  rule on `POST /api/consent` for both hostnames, keyed on IP, around 10
  requests per minute, responding 429. The rule is configured in the
  Cloudflare dashboard by Wouter and is not in this repo; the route carries a
  comment saying so, and the IP never reaches Postgres. The client already
  treats 429 as retry-later.
- No request body is logged.

## Client

All in `packages/analytics/src/client.tsx`, which already owns consent state.

**Device record** (localStorage `ob_cookie_consent`, extended):
`{ v, exp, h, ver, cid }` — `cid` is the `consent_id`. Existing records without
`cid` get one generated on next read and emit one event for their current
state, so today's visitors are backfilled without being re-prompted.

**Outbox** (localStorage `ob_consent_outbox`): an array of pending events, each
with its own `idempotencyKey` generated when the event is created.

- `accept()` / `decline()` write the device record first, then enqueue, then
  flush. The UI never waits on the network.
- Flush sends oldest first. 2xx removes the entry. 4xx (other than 429) drops
  it and reports to Sentry: a malformed event will never succeed. 429, 5xx and
  network errors keep it and back off (2s, 8s, 30s, then on next page load).
- Flush also runs on page load and on `online`.
- The outbox is capped at 20 entries; oldest are dropped first.
- When the server returns `expiresAt`, the device record's `exp` is replaced
  with it, so device and evidence agree on expiry.

**Linking**: `useAnalyticsIdentity(userId)` already sees the user id arrive.
When it does and a device record exists, enqueue one `linked` event per
`(cid, userId)` pair, remembered in localStorage so it is not re-sent on every
visit. This runs whether analytics was accepted or declined.

**Withdrawal**: the provider gains `withdraw()`. The banner is not shown again
after a decision, so a "Cookie settings" link in the footer of both apps
reopens it. Withdrawing sets the device record to declined, enqueues
`withdrawn`, calls `posthog.opt_out_capturing()` and reloads.

## Not changing

- Gating stays as it is: PostHog initialises only when the device record says
  accepted.
- The EU timezone heuristic for showing the banner stays. It decides whether
  to ask, not whether consent was given; visitors who are never asked are
  never tracked, because gating is opt-in.

## Erasure and retention

- Erasure (audit D5, separate work): null `user_id` on that user's rows.
- Retention: rows are kept for 5 years after `created_at`, then deleted by the
  existing retention cron. The privacy policy's retention table gets a
  "Consent records" row.

## Testing

- Route: validation failures, unknown keys, oversize body, idempotent repeat,
  `linked` without session, `user_id` taken from session and not from body.
- Cloudflare rule: checked by hand after it is created (burst of requests
  returns 429).
- Client: outbox ordering, retry and drop rules, cap, backfill of records
  without `cid`, single `linked` per pair, `exp` adopted from server.
- Migration applies twice without error.
