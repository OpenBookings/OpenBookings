# Consent Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Written for native execution in the session that wrote it: each task names its files, interfaces and test cases; the code is written test-first during execution rather than duplicated here.

**Goal:** Record every cookie-consent decision as an append-only server-side event, without storing an IP, while the device stays the source of truth for gating.

**Architecture:** All logic lives in `packages/analytics` as small, dependency-injected units: an event schema, a request handler factory (storage and session lookup injected), and a client outbox (storage and fetch injected). Each app mounts the handler at `POST /api/consent`. `packages/db` owns the table and the insert.

**Tech Stack:** Next.js route handlers, zod 4, Postgres (hand-applied SQL + Drizzle table), Bun test.

**Spec:** `docs/compliance/specs/2026-10-02-consent-log-design.md`

## Global Constraints

- No IP address, user agent or request body is written to Postgres or logged.
- `user_id` is never read from the request body; only from the server session.
- `expires_at` and `created_at` are set by the server: `expires_at = now() + 90 days`.
- Event types: `granted`, `denied`, `withdrawn`, `linked`. Categories: `{ analytics: boolean }`, unknown keys rejected.
- `banner_version` format: `<CONSENT_VERSION>+<privacy document id>`, e.g. `1.1+privacy@2026-10-02/en`; max 100 chars.
- Idempotency: `idempotency_key` is unique; a repeat returns the same 200 body.
- Body cap 2 KB; `Content-Type: application/json` required; same-origin only.
- Rate limiting is Cloudflare's (dashboard rule on `POST /api/consent`, both hostnames); no in-app limiter. The route carries a comment saying so.
- The UI never waits on the network: device record first, then enqueue, then flush.
- Gating is unchanged: PostHog initialises only when the device record says accepted.
- Migration file is `0017_consent_log.sql` (the spec said 0018; consent ships before step-up, so it takes the next free number and step-up takes 0018).
- Hand-applied SQL, idempotent, same convention as `0016`.

## Review Focus

1. **A visitor with no network accepts cookies** — analytics must start immediately and the event must be delivered on a later page load. (Task 3 tests: flush keeps on network error.)
2. **localStorage throws or is unavailable** (private mode, blocked site data) — accepting must still work for the page view and nothing may crash. (Task 3: storage that throws.)
3. **A forged request carries a `userId` or extra keys** — rejected, never stored. (Task 2 tests.)
4. **Double-click / retry sends the same event twice** — one row. (Task 2: idempotent repeat.)
5. **An existing visitor from before this release** (device record without `cid`) — not re-prompted, backfilled with one event. (Task 3 + Task 4.)

---

### Task 1: Table, migration, insert

**Files:** Create `packages/db/drizzle/0017_consent_log.sql`; modify `packages/db/src/schema.ts` (add `consentLog`); create `packages/db/src/consent.ts`; modify `packages/db/src/index.ts` (re-export).

**Produces:**
```ts
export type ConsentEventRow = {
  consentId: string; eventType: 'granted' | 'denied' | 'withdrawn' | 'linked';
  categories: { analytics: boolean }; bannerVersion: string;
  app: 'web' | 'business'; userId: string | null; idempotencyKey: string;
};
/** Inserts or, on a repeated idempotency key, returns the first row's expiry. */
export function insertConsentEvent(row: ConsentEventRow): Promise<{ expiresAt: string }>;
```
SQL: `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING expires_at`, falling back to `SELECT expires_at ... WHERE idempotency_key = $1`.

No DB-backed test (no test database in this repo's unit runs); verified by typecheck and by the SQL being applied by hand.

### Task 2: Event schema and request handler

**Files:** Create `packages/analytics/src/consent-events.ts`, `consent-route.ts`, `consent-route.test.ts`; modify `packages/analytics/package.json` (zod, test script, `./consent-route` and `./consent-events` exports).

**Produces:**
```ts
export const consentEventSchema: z.ZodType<ConsentEvent>;  // strict
export type ConsentEvent = { consentId: string; eventType: ...; categories: { analytics: boolean }; bannerVersion: string; idempotencyKey: string };
export function createConsentHandler(deps: {
  app: 'web' | 'business';
  insert: (row: ConsentEventRow) => Promise<{ expiresAt: string }>;
  getUserId: () => Promise<string | null>;
}): (req: Request) => Promise<Response>;
```
**Tests:** valid event → 200 `{ ok: true, expiresAt }` and insert called with session user id; unknown key → 400; `userId` in body → 400 and never inserted; bad uuid → 400; wrong content type → 415; body over 2 KB → 413; cross-origin `Origin` → 403; missing `Origin` allowed (same-origin fetches from some browsers omit it on same-origin GET, but POST sends it; non-browser clients omit it — allowed, Cloudflare limits abuse); `linked` without session → 401; insert throwing → 500 with no detail; malformed JSON → 400.

### Task 3: Client outbox

**Files:** Create `packages/analytics/src/consent-outbox.ts`, `consent-outbox.test.ts`.

**Produces:**
```ts
export type OutboxDeps = { storage: Pick<Storage, 'getItem' | 'setItem'>; fetch: typeof fetch; onDrop?: (e: ConsentEvent, status: number) => void };
export function enqueueConsentEvent(deps: OutboxDeps, event: ConsentEvent): void;
/** Sends oldest first; returns the server expiry of the last delivered event, if any. */
export function flushConsentOutbox(deps: OutboxDeps): Promise<{ expiresAt: string | null; remaining: number }>;
```
**Tests:** enqueue persists; flush sends oldest first and empties on 200; 400 drops the entry and calls `onDrop`; 429/500/network error keep the entry and stop the flush; cap of 20 drops oldest; storage that throws does not throw out of enqueue/flush; corrupt stored JSON is treated as empty; concurrent flush calls do not double-send.

### Task 4: Wire the client

**Files:** Modify `packages/analytics/src/client.tsx`; `apps/web/components/CookieBanner.tsx`, `apps/business/components/CookieBanner.tsx`; `apps/web/components/nav.tsx` (Cookie Settings button); `apps/business/components/business/Footer.tsx`.

- Device record gains `cid`; a record without one gets a `cid` and enqueues one event for its current state (backfill).
- Provider takes `bannerVersion` and `endpoint` props; exposes `accept`, `decline`, `reopen`, `reviewing`.
- `accept`/`decline`: write device record, enqueue, flush; adopt server `expiresAt` into the device record.
- Declining after a previous accept emits `withdrawn`, calls `posthog.opt_out_capturing()` and reloads.
- `useAnalyticsIdentity`'s sibling `useConsentLinking(userId)`: one `linked` event per `(cid, userId)`, remembered in localStorage.
- Flush on mount and on `online`.
- Banner shows when `consent === null || reviewing`.

### Task 5: Mount the routes

**Files:** Create `apps/web/app/api/consent/route.ts`, `apps/business/app/api/consent/route.ts`; modify both `app/layout.tsx` (pass `bannerVersion`); add `@openbookings/analytics` consent exports to `transpilePackages` if needed.

### Task 6: Policy version with the consent record

**Files:** Create `apps/web/content/legal/privacy/2026-10-03/{en,nl,fr}.mdx` (copy of 2026-10-02 plus: cookie-table note that the choice is also recorded on our servers without an IP address; retention row "Consent records — 5 years"; note on how to change the choice via Cookie Settings); register as current; extend `documents.test.ts`.

## Left for Wouter

- Apply `0017_consent_log.sql` to the database before deploying.
- Create the Cloudflare rate limiting rule on `POST /api/consent` for both hostnames (about 10 requests per minute per IP, respond 429).
- Retention purge of rows older than 5 years belongs to the retention cron, which currently has no scheduler (audit D4b); not built here.
