# @openbookings/auth

Better Auth setup shared by `apps/web` (guest portal) and `apps/business`
(host portal). One email = one account; an account is either guest
(`account_type = 'private'`) or host (`account_type = 'business'`), never
both, enforced in one `user` table in the single Neon Postgres.

## The host/guest boundary

Three layers, all of which must hold:

1. **Sign-in time** — `session.create.before` rejects a user whose
   `account_type` doesn't match the app, and stamps the session row with
   `portal` (`'guest'` / `'host'`).
2. **Every read** — `sessionForApp()` re-checks `account_type` and `portal`
   on each session resolution. Both apps' `getServerSession()` and their
   middleware go through it; never call `auth.api.getSession` directly in
   app code.
3. **Cookies** — each instance has its own cookie namespace (`ob-guest` /
   `ob-host`) from the required `AUTH_COOKIE_PREFIX` env var.
   `crossSubDomainCookies` is disabled and no `Domain` attribute is ever
   set. In production (https base URL) the four core cookies are named with
   the browser-enforced `__Host-` prefix.

## Environment (validated in `src/env.ts`, throws at boot)

| Var | Value |
|---|---|
| `BETTER_AUTH_SECRET` | ≥ 32 chars |
| `AUTH_COOKIE_PREFIX` | `ob-guest` (web) / `ob-host` (business) |
| `AUTH_BASE_URL` | app origin; `BETTER_AUTH_URL` accepted as legacy alias |

Validation is skipped during `next build` (`NEXT_PHASE`), because Docker
builds only receive `NEXT_PUBLIC_*` args; it runs when the server boots.

## Local development

Cookies ignore ports, so two apps on `localhost` share one cookie jar and
the boundary is untestable. Dev therefore runs on:

- guest: `http://app.localhost:3002`
- host: `http://business.localhost:3001`

Chrome and Firefox resolve `*.localhost` to 127.0.0.1 without config. For
Safari add to `/etc/hosts`:

```
127.0.0.1 app.localhost
127.0.0.1 business.localhost
```

Signing in on one dev app must leave the other unauthenticated — if it
doesn't, the boundary is broken.

**OAuth redirect URIs**: the Google (both clients), Apple, and Microsoft
apps need the new dev callback origins registered, e.g.
`http://app.localhost:3002/api/auth/callback/google` and
`http://business.localhost:3001/api/auth/callback/google` (same pattern per
provider). Until then, magic-link sign-in works unchanged in dev.

## Production rollout order (PR "auth boundary")

1. Apply `packages/db/drizzle/0007_auth_boundary.sql` by hand (adds
   `session.portal` + backfill). Must land **before** the deploy — sessions
   write `portal` on creation from then on.
2. Set `AUTH_COOKIE_PREFIX` (and optionally `AUTH_BASE_URL`) on both Cloud
   Run services. Missing vars fail the boot loudly by design.
3. Deploy. The cookie rename (`better-auth.*` → `__Host-ob-*.*`) signs
   everyone out once; existing sessions stay valid server-side but the old
   cookie is never read again.
