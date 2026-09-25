# Upstash Redis caching — first implementation

**Date:** 2026-09-25
**Status:** approved design, not yet implemented
**Scope:** one cached surface (`/p/[hotel_slug]` in `apps/web`) plus the shared
mechanism every later cache site will reuse.

## Why

Three goals, in the order they matter:

1. **Latency.** `/p/[hotel_slug]` runs three parallel Postgres queries on every
   request, one of them (the hero query) large. A cache hit in Frankfurt costs
   ~10ms from the Amsterdam container; the three queries cost considerably more.
2. **Neon cost and load.** The page's content changes on the order of weeks.
   Serving it from Postgres for every visitor and every crawler is paying
   repeatedly for an answer that has not changed.
3. **Resilience.** A Neon cold start or brief outage currently renders an error.
   It should render a slightly old page instead.

A fourth thing falls out of this work rather than motivating it: cross-app cache
invalidation has never worked. `apps/business/app/(dashboard)/dashboard/listings/property/_lib/actions.ts`
calls `revalidatePath("/p/${slug}")` under a comment promising guests will not
see stale HTML, but that path belongs to `apps/web` — a different Next app in a
different container — so the call does nothing. The Redis purge below is the
first mechanism that actually delivers what that comment claims.

## Approach chosen

**Application-level caching** of the page's query results, in a shared workspace
package, with explicit purging from the writing app.

The alternative considered and deferred was Next 16's `"use cache"` with a
custom cache handler persisting to Upstash. It caches the rendered output too,
which is a larger latency win, but invalidation has to cross an app boundary:
`revalidateTag` in `apps/business` only reaches `apps/web` if both apps run
compatible cache handlers writing tag-expiry records into a shared keyspace.
That depends on Next's cache-handler internals, the least stable surface in the
framework, and `cacheComponents` is app-wide — it changes how every route in
`apps/web` treats data. Too much blast radius and too much coupling for a first
step. The key scheme below is chosen so this can be layered on later without
rework.

## Components

### `packages/cache` — the mechanism

New workspace package, modelled on `packages/db`: `exports: { ".": "./src/index.ts" }`,
tsconfig extending `@openbookings/config/tsconfig.base.json`, single runtime
dependency `@upstash/redis`.

Public surface:

| Export | Purpose |
| --- | --- |
| `getRedis(): Redis \| null` | `globalThis`-pinned singleton, mirroring `__pgPool` in `packages/db/src/index.ts`. Returns `null` when `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is absent. |
| `cached<T>(key, loader, opts): Promise<T \| null>` | Read-through with stale-on-error. `null` from the loader means "no such row" and is cached as a negative entry, so the return type admits it. Behaviour specified below. |
| `purge(keys: string[]): Promise<void>` | Deletes keys. Never throws; reports failures and returns. |
| `propertyPageKey(slug: string): string` | The key builder. Exported so `apps/web` and `apps/business` cannot disagree about spelling. |

`getRedis()` returning `null` is what makes local development and CI work with
no cache and no branching at call sites: `cached` simply invokes the loader.
No test in this work talks to a real Redis, so CI needs no new secrets.

### Key scheme

```
ob:v1:prop-page:<slug>
```

`v1` is a **payload-shape version**, not an API version. When the cached shape
changes, that constant changes; every old entry is orphaned and expires on its
own TTL. A shape change is therefore a deploy, never a migration or a manual
flush — and never a window where new code reads old-shaped JSON.

### Payload

```ts
interface Envelope<T> {
  /** `null` is a cached *absence*, not a cache miss — see Negative caching. */
  data: T | null;
  freshUntil: number; // epoch ms
}

interface PropertyPagePayload {
  hotel: HotelPageData;
  amenities: { label: string; icon: string; category: string; sort_order: number }[];
  rooms: DbRoom[];
}
```

The three query results verbatim. The page's amenity-grouping loop stays in the
page: it is presentational, cheap, and caching its output would couple the cache
shape to a rendering decision.

Every timestamp in these rows already leaves Postgres as a `to_char` string and
every nested aggregate is a plain JSON object, so the payload survives a
`JSON.stringify`/`parse` round trip with no custom revivers. This is a
precondition, not a coincidence, and a test asserts it against a realistic
fixture — a future `SELECT` that adds a bare `timestamptz` column would
otherwise silently start returning strings where callers expect `Date`.

## Read path

Two TTLs, both env-tunable:

- **Logical freshness** — `CACHE_TTL_PROPERTY_PAGE_S`, default `3600` (1 hour).
  Written into the envelope as `freshUntil`.
- **Physical TTL** — `CACHE_MAX_AGE_PROPERTY_PAGE_S`, default `86400` (24 hours).
  Set as the Redis key expiry. The gap between the two is the window in which a
  stale copy is available to absorb a database failure.

`cached(key, loader, opts)` resolves one of five ways:

| Case | Behaviour |
| --- | --- |
| Fresh hit (`now < freshUntil`) | Return `data`. No database contact. |
| Stale hit, loader succeeds | Write through with a new `freshUntil`, return fresh data. |
| Stale hit, loader throws | Return the stale `data`. Report the loader error to Sentry. This is goal 3. |
| Miss | Run loader, write through, return. |
| Redis throws (any operation) | Run the loader and return its result. Reported to Sentry at most once per request, not once per failed operation — a Redis outage must not turn one error into three per page view. Writes are attempted but their failures are swallowed. |

A cache outage therefore degrades to exactly today's behaviour. It can never
take the page down — the failure mode of a performance optimisation must not be
an outage.

### Negative caching

A slug with no active property is cached as an explicit negative entry with a
60-second TTL (`CACHE_TTL_PROPERTY_PAGE_MISS_S`). Without it, a crawler walking
invented slugs runs three Postgres queries per 404 indefinitely, which undercuts
goal 2 precisely when load is highest. The envelope distinguishes a cached
absence from a cache miss; `getHotelPage` returns `null` and the page calls
`notFound()` as it does today.

One consequence, accepted and documented: if someone visits a slug in the minute
before that property is created, they may see a 404 for up to 60 seconds after it
goes live. Onboarding mints a fresh slug per property
(`apps/business/app/(onboarding)/onboarding/promotion.ts`), so hitting this
requires guessing the slug first. Not worth a purge.

### `apps/web` wiring

A new `apps/web/lib/hotel-page-data.ts` exports `getHotelPage(slug)`: it owns the
three `db.execute` calls currently inlined in the page and wraps them in
`cached(propertyPageKey(slug), loader, …)`. `apps/web/lib/hotel-page-query.ts`
is untouched — it already exists as the single definition of the hero query for
exactly this kind of reason.

`page.tsx` loses its `Promise.all` and its `getDb()` call and gains one `await
getHotelPage(slug)`. Everything from `if (!hotel) notFound()` downward is
unchanged. Rendering behaviour is identical by construction, which is why the
page gets no new test.

## Write path — invalidation

The cached blob spans `properties`, `property_content`, `property_highlights`,
`payment_methods`, `property_images`, `amenities`/`property_amenities`, `rooms`,
`room_images`, `room_amenities` and `rate_plans`. Four sites in `apps/business`
write to those tables.

A single helper, `apps/business/lib/purge-property-page.ts`, resolves an id to a
slug and purges, so the key-lookup logic exists once:

```ts
purgePropertyPage({ propertyId })  // SELECT slug FROM properties WHERE id = $1
purgePropertyPage({ roomId })      // SELECT p.slug FROM rooms r JOIN properties p …
```

Call sites:

1. **`(dashboard)/dashboard/listings/property/_lib/actions.ts`** — inside
   `revalidateBoth(propertyId)`, which already resolves the slug and is already
   called by all seven save actions. One line covers the whole property-content
   editor.
2. **`(dashboard)/dashboard/listings/rates-availability/_lib/actions.ts`** —
   `createRatePlan` only. It writes `rate_plans`, which the page's rooms query
   selects.
3. **`api/upload/confirm/route.ts`** — both branches: the `roomId` branch writes
   `room_images`, the `propertyId` branch writes `property_images`.
4. **`api/property-images/[id]/route.ts`** — `PATCH` and `DELETE`. Both already
   look up `property_id` for the ownership check, so the id is in hand.

Deliberately **not** purged, because the cached payload does not contain what
they write:

- `setAvailability`, `setRestriction`, `clearRestrictions`, `publishAriChanges`
  — date-scoped ARI tables. The page shows `rate_plans.bar`, not per-date rates.
- `closeRoomType`, `reopenRoomType` — `room_closures`, which the page never
  queries.

Recording this reasoning matters more than the omissions themselves: when the
listing page later starts showing live availability, this list is where someone
will look to find out what suddenly needs purging.

`purge` deletes the key rather than marking it stale, which deliberately
forfeits the resilience fallback for that one slug until the next request
repopulates it. That is the correct trade: after a host edits their page, the
stale copy is known-wrong content, and serving known-wrong content to survive a
database outage is a worse failure than showing an error.

`apps/business` therefore needs the Upstash credentials too.

## Configuration

| Variable | Web | Business | Notes |
| --- | --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | yes | yes | Existing database (see region note below) |
| `UPSTASH_REDIS_REST_TOKEN` | yes | yes | |
| `CACHE_TTL_PROPERTY_PAGE_S` | yes | — | default 3600 |
| `CACHE_MAX_AGE_PROPERTY_PAGE_S` | yes | — | default 86400 |
| `CACHE_TTL_PROPERTY_PAGE_MISS_S` | yes | — | default 60 |

Set on both Scaleway Serverless Containers (`nl-ams`) out of band, as the other
runtime secrets are — CI passes no application env at deploy time, it only rolls
images. Absent, both apps behave exactly as they do today.

Region note, because the latency goal rests on it. The database is an Upstash
**Global** database with a single region, whose endpoint
(`global-latency.upstash.io` → `global-euw2.upstash.io`) resolves to AWS
`eu-west-2`, London — not Frankfurt, as first assumed. Amsterdam to London is
roughly 7–10ms, near-identical to Frankfurt, so the latency argument holds
unchanged. A cache in a US region would have made the page slower than it is
today, which is why the region is recorded rather than left implicit.

Being single-region also settles a question a multi-region Global database would
have raised: Upstash replicates writes to read replicas asynchronously, so a
`DEL` issued by `apps/business` could have been invisible to a read served to
`apps/web` from another replica for the replication window. Upstash's
Read-Your-Writes sync token cannot close that gap here, because it is a
checkpoint held inside a single client instance and these are two clients in two
containers. With one region there is one node, so no such window exists. Should
read regions ever be added, this paragraph is the warning that invalidation
becomes eventually consistent at that moment.

## Observability

`cached` emits one structured line per resolution — outcome (`hit` / `stale` /
`miss` / `negative` / `bypass`), key, and loader duration when it ran.

**`console.log` initially, by decision, then Sentry.** The first deploy is about
learning the real hit ratio and loader timings from container logs; the shape of
the Sentry instrumentation should be chosen once those numbers exist rather than
guessed now. Errors are the exception and go to Sentry from day one: a loader
failure served from stale cache is invisible to the user and would otherwise
never be noticed.

## Testing

`bun test`, colocated as `packages/cache/src/cached.test.ts`, against a fake
Redis (a `Map` with explicit TTL control) — no network, no secrets:

- fresh hit returns cached data and never calls the loader
- stale hit with a succeeding loader returns fresh data and writes through
- stale hit with a throwing loader returns the stale copy
- miss runs the loader and writes through
- Redis throwing on read, on write, and on both falls through to the loader
- `getRedis()` returning `null` invokes the loader directly
- negative entries return the cached absence without calling the loader
- a realistic `PropertyPagePayload` fixture survives a JSON round trip unchanged

## Out of scope

Named so the boundary is deliberate rather than accidental:

- **Single-flight locking.** Concurrent requests on a cold key all hit Postgres.
  At this traffic level that is three queries, not a thundering herd. The place
  a `SET NX` lock goes is documented in `cached`'s comments for when it matters.
- **`apps/web/lib/rateLimit.ts`.** Its own comment asks for Redis, and it is the
  obvious second migration — but it is a correctness change (per-instance
  buckets become shared), not a caching one, and deserves its own consideration.
- **Every other route.** One measured surface first.
- **Rendered-output caching** (the deferred Approach B above).
