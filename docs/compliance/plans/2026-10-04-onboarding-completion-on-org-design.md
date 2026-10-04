# Onboarding completion on the organisation — design

Date: 2026-10-04
Branch: `compliance/remediation`

## Problem

`host_onboarding` is the onboarding wizard's scratchpad: per-user step
progress and step payloads. `completeOnboarding()` copies those payloads into
their final homes (`organization`, `org_profile`, `member`, `org_consent`,
`properties`), but the "onboarding is complete" flag stays in the scratchpad
(`host_onboarding.onboarding_completed_at`). Everything that asks "is this
host past the wall?" reads it there:

- `apps/business/proxy.ts` — the dashboard/onboarding wall
- `apps/business/app/(onboarding)/onboarding/_lib/status.ts` — step routing
  and the verify step's status
- `apps/business/app/api/stripe/account-link/route.ts` — who may get a Stripe
  onboarding link
- `apps/business/lib/stripe-events.ts` + `app/api/stripe/webhook/route.ts` —
  marks onboarding complete on `account.updated`

This causes:

1. **The webhook can complete a host with no organisation.** If
   `account.updated` arrives before the verify step calls
   `completeOnboarding()`, the flag is set without provisioning. The proxy
   then sends the host to `/dashboard` and `completeOnboarding()` never runs.
2. **Stripe readiness is only checked in the browser.** `completeOnboarding()`
   is a server action that checks only that legal step data exists; calling it
   directly passes the wall before Stripe approves the account.
3. **Invited members are stuck in onboarding.** They have no
   `host_onboarding` row, so the proxy never considers them complete.
4. **A removed owner reaches an empty dashboard.** Their row's flag is still
   set, so the proxy lets them in although they belong to no organisation.

## Decisions

- Completion lives in one column: `org_profile.onboarding_completed_at
  timestamptz NULL` (a timestamp rather than a boolean: same check, keeps
  when). `host_onboarding` is consulted only for step-level detail.
- Only `completeOnboarding()` writes the column. The webhook no longer marks
  completion.
- `host_onboarding` rows are **kept as-is** after completion (decided
  2026-10-04). Nothing gates on them any more, so their staleness cannot cause
  a wrong decision.

## Design

### Two derived facts

Both are derived from `org_profile.onboarding_completed_at`; neither is
stored.

- **`hasCompletedOrg(user)`** — the user is a member (any role) of at least
  one organisation whose `onboarding_completed_at` is set.
- **`wizardInProgress(user)`** — the user has a `host_onboarding` row, and the
  row's `step_data->>'stripe_account_id'` is not the `stripe_account_id` of
  any organisation whose `onboarding_completed_at` is set. A row with no
  Stripe account yet is in progress.

"Wizard finished" means the opposite of `wizardInProgress` for a user who has
a row: the Stripe account the wizard created belongs to a completed org.

Membership is used, not the session's `activeOrganizationId`: new sign-ins do
not set an active organisation (only `provisionOrganizationTx` writes it, to
already-existing sessions), so gating on it would lock returning hosts out.

### The wall

A pure function in `apps/business/lib/onboarding-wall.ts`, following the
`accountLinkDecision` pattern:

```ts
onboardingWallDecision({ path, hasCompletedOrg, wizardInProgress })
  // => "allow" | "/onboarding" | "/dashboard"
```

- `/dashboard*`: allow if `hasCompletedOrg`, else redirect to `/onboarding`.
- `/onboarding*`: allow if `wizardInProgress || !hasCompletedOrg`, else
  redirect to `/dashboard`.

`proxy.ts` fetches both facts in one query and calls the function.

| User | Before | After |
|---|---|---|
| Host mid-wizard | onboarding | onboarding |
| Host finished | dashboard | dashboard |
| Invited member, never ran the wizard | stuck in onboarding | dashboard |
| Member of org X onboarding their own business | onboarding | onboarding |
| Owner removed from their organisation | empty dashboard | onboarding, "no access" state |

No redirect loop is possible: a user without a completed org is always
allowed on `/onboarding`.

### Onboarding pages and status

`_lib/status.ts`:

- `getOnboardingRow(userId)` joins `org_profile` and returns, besides the
  existing fields, `wizardFinished` (the row's Stripe account is on a
  completed org) and `hasCompletedOrg`.
- `resolveOnboardingRedirect(row)`: if `wizardFinished`, return `/dashboard`
  when `hasCompletedOrg`, otherwise return the literal `"no-access"`. The
  rest of the step routing is unchanged.
- `onboarding/page.tsx` renders `"no-access"` as a static "You no longer have
  access to this organisation" state (no redirect). Step pages such as
  `onboarding/stripe/page.tsx` redirect `"no-access"` to `/onboarding`.
- `getOnboardingStatus(row).onboardingCompleted` becomes `wizardFinished`.

### `completeOnboarding()`

In `onboarding/actions.ts`, before the transaction:

1. Load the wizard's Stripe account id; refuse if missing.
2. **Ex-owner guard:** refuse if that Stripe account is on an organisation
   whose `onboarding_completed_at` is set. This stops a removed owner from
   provisioning a second organisation on the same Stripe account.
3. **Readiness:** fetch the account (`retrieveConnectAccount`) and refuse
   unless `isStripeAccountReady(summariseStripeAccount(account))`.

Inside the existing transaction, after property linking:

4. `UPDATE org_profile SET onboarding_completed_at = NOW()
    WHERE organization_id = $1 AND onboarding_completed_at IS NULL`
   for the organisation `provisionOrganizationTx` returned (new or existing).
5. **Transition dual-write:** keep the existing
   `UPDATE host_onboarding SET onboarding_completed_at = NOW()` until
   migration 0021, so a rollback to the previous code still sees newly
   completed hosts as complete.

### `isStripeAccountReady(account)`

One predicate replacing the copies in `verify.tsx` and `stripe-events.ts`:
`currentlyDue` is empty, `chargesEnabled` and `payoutsEnabled` are both true.
It lives in `apps/business/lib/stripe-readiness.ts` with no server-only
imports, so the client verify step can use it, and takes the
`OnboardingStatus["stripe"]` summary shape. The mapping from a Stripe
`Account` to that shape, currently inline in `getOnboardingStatus`, is
extracted as `summariseStripeAccount(account)` in `_lib/status.ts` and used
by both `getOnboardingStatus` and `completeOnboarding()`.

### Webhook

`stripe-events.ts`: remove the readiness branch of `account.updated` and the
`markOnboardingComplete` dependency (and its implementation in
`app/api/stripe/webhook/route.ts`). The event is still deduplicated and
marked processed. A host approved while away completes on return, through the
verify step's polling.

### Verify step

`_steps/verify.tsx`: use `isStripeAccountReady`; add a `.catch` to the
`completeOnboarding()` call that resets `completingRef` and shows the error,
so a server refusal no longer leaves a permanent spinner.

### Account-link route

`app/api/stripe/account-link/route.ts`: the "mid-onboarding, owner-to-be"
branch keys on `wizardInProgress` instead of the row's own flag. A removed
ex-owner whose row still exists is therefore not mid-onboarding, falls
through to the ownership check and is refused, as today.

### Migration

`packages/db/drizzle/0020_org_onboarding_completed.sql`, applied by hand
**before** deploying the code, idempotent:

```sql
ALTER TABLE org_profile
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz NULL;

UPDATE org_profile op
SET onboarding_completed_at = ho.onboarding_completed_at
FROM "member" m
JOIN host_onboarding ho ON ho.user_id = m."userId"
WHERE m."organizationId" = op.organization_id
  AND m.role = 'owner'
  AND ho.onboarding_completed_at IS NOT NULL
  AND op.stripe_account_id = ho.step_data->>'stripe_account_id'
  AND op.onboarding_completed_at IS NULL;
```

Matching on the Stripe account as well as ownership marks only the
organisation the wizard was for, even when a host owns several.

Hosts the webhook completed without an organisation get no flag (they have
no `org_profile`). They return to `/onboarding/stripe`, where
`completeOnboarding()` now provisions their organisation, which repairs
problem 1.

`packages/db/src/schema.ts`: add the column to `orgProfile`; update the
`hostOnboarding.onboardingCompletedAt` comment (the proxy no longer gates on
it). `packages/stripe/scripts/discard-test-accounts.ts`: also reset
`org_profile.onboarding_completed_at`.

Follow-up `0021`, applied once the deploy is stable: drop
`host_onboarding.onboarding_completed_at`, remove the dual-write and the
column from `schema.ts` and the discard script.

## Testing

Tests sit next to the code (`*.test.ts`) and are written first.

- `lib/onboarding-wall.test.ts` — table test: the five user types above, on
  both `/dashboard` and `/onboarding`.
- `lib/stripe-readiness.test.ts` — ready; and each of the three conditions
  failing alone.
- `lib/stripe-events.test.ts` — `account.updated` no longer triggers any
  completion side effect.
- `lib/account-link-policy.test.ts` — an ex-owner who still has a row is
  refused.
- SQL: on a Neon branch of the production database, apply 0020; check the
  number of backfilled orgs against `host_onboarding` rows with the flag set
  (and list any that did not match); run the wall query for one user of each
  type.

## Out of scope

- **New sign-ins set no active organisation**, so `getOrgScopedDb` returns
  null for a returning host until something sets it. Separate fix.
- **Co-owners onboarding their own business:** `provisionOrganizationTx`
  returns any organisation the user already owns, so an invited co-owner who
  runs the wizard for a new business is attached to the existing one.
  Unchanged by this work; needs its own design.
