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

## Microsoft OAuth (host portal only)

One **multi-tenant** app registration in our own Entra tenant. Scopes are
`openid profile email` only (`disableDefaultScope` — no `User.Read`, no
Graph calls; the profile-photo fetch is disabled).

- **Email claim**: Microsoft does not reliably send `email`; the host
  instance falls back to `preferred_username` / `upn` only when they are
  email-shaped (`microsoftEmailFromProfile`). A user whose token has no
  email-shaped claim cannot sign up — by design, since magic-link recovery
  and the one-email-one-account invariant need a routable address.
- **Tenant id**: the `tid` claim is stamped onto `account.tenant_id`
  (migration `0008_microsoft_tenant.sql`) for org auto-join later.
- **Admin consent** (for support): many M365 tenants block user consent to
  third-party apps. A tenant admin can pre-approve us by visiting:

  ```
  https://login.microsoftonline.com/{their-tenant-id}/adminconsent?client_id={our-client-id}&redirect_uri=https://business.openbookings.co
  ```

  (`common` also works in place of the tenant id if they are signed in as
  admin.) Until consent is granted those users see AADSTS65001/90094 —
  point them at their IT admin with that URL.

## Account linking

Implicit (sign-in-time) OAuth account linking is **disabled** on both
instances (`disableImplicitLinking: true`). With hard email exclusivity, an
OAuth sign-in on the wrong portal must fail outright instead of Better Auth
attaching the OAuth account row to the other portal's user before the
session hook rejects it (orphan `account` row on a user who never consented
to it). Explicit linking via `linkSocial()` while signed in still works.
Consequence to know about: a user who signed up with magic link cannot
implicitly attach Google/Microsoft by just signing in with it — they get the
collision/not-linked error and must link from account settings once that UI
exists.

Signup with an email that already exists (either portal) is rejected in
`user.create.before` with a clear message ("already registered as a
guest/host account") instead of a raw Postgres unique-violation error.

## Passkeys, step-up, and recovery (host portal)

**Factors**: passkey (`@better-auth/passkey`) with TOTP two-factor as
fallback. Recovery/backup codes come from the twoFactor plugin — generated
when a host enables two-factor; the passkey plugin has none (verified
against plugin source).

**Enrollment UX** (UI still to build — see follow-up tasks): prompt after
first host sign-in; push adding a second passkey on a different device.
Enrollment copy must say passkeys sync via iCloud Keychain / Google
Password Manager — most users assume they are device-bound. An org can set
`org_profile.auth_policy = '{"requirePasskey": true}'` to block members
from deleting their last passkey (enforced server-side).

**Step-up**: `session.lastVerifiedAt` is stamped at sign-in and refreshed
by a successful passkey/TOTP/backup-code verification. Sensitive actions
require it fresher than 15 minutes — recency is the mechanism; merely
owning a passkey proves nothing about who holds this session cookie. The
gate reads the session row from the database, never the cookie cache.
Enforced today on the Better Auth endpoints: organization delete, member
removal, promotion to owner/admin, change email, delete user (403
`STEP_UP_REQUIRED`). The remaining gated actions from the handoff — change
Stripe payout destination, bulk guest-data export — are app endpoints that
must call `isStepUpFresh` when they are built. Everything else (bookings,
rates, ARI, messaging, property content, statements) runs on a normal
session.

**Recovery ladder** (staff runbook):
1. Another org admin triggers re-enrollment — covers most multi-person
   hotels.
2. Recovery codes issued at two-factor enrollment.
3. Email recovery with a 24–72h cooldown before the new credential can
   authorize payout changes; notify all owners/admins immediately; keep
   the old passkey valid during the window so a real owner can cancel.
4. Manual verification by staff: KvK number, Stripe account holder name,
   last payout amount and date, recent booking reference. Identity
   documents alone are NOT sufficient — they prove who someone is, not
   that they control this account. Log everything to audit_log.

**Hard rule** (enforced via `payoutChangeBlockedUntil`): staff credential
resets write `audit_log` action `recovery.credential-reset`; the
payout-destination endpoint must refuse changes for
`RECOVERY_PAYOUT_COOLDOWN_HOURS` (72h) after the latest such row.

## Session hygiene (host portal)

- Host sessions: 24h idle expiry, hourly refresh (guest keeps Better
  Auth's 7-day default).
- Every sign-in writes `audit_log` action `auth.sign-in`; a user-agent
  never seen for that user emails all org owners
  (`sendSecurityAlert` in apps/business). This log is also the feed for
  Tirreno once that integration lands.
- Device list + revoke: Better Auth's `listSessions` / `revokeSession`
  endpoints are mounted; the Account → Security UI still needs building.

## Production rollout order (PR "auth boundary")

1. Apply `packages/db/drizzle/0007_auth_boundary.sql` by hand (adds
   `session.portal` + backfill). Must land **before** the deploy — sessions
   write `portal` on creation from then on.
2. Set `AUTH_COOKIE_PREFIX` (and optionally `AUTH_BASE_URL`) on both Cloud
   Run services. Missing vars fail the boot loudly by design.
3. Deploy. The cookie rename (`better-auth.*` → `__Host-ob-*.*`) signs
   everyone out once; existing sessions stay valid server-side but the old
   cookie is never read again.
