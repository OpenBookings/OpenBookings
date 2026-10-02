# Payout Safety and Step-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Written for native execution in the session that wrote it: each task names its files, interfaces and test cases; code is written test-first during execution rather than duplicated here.

**Goal:** Close what is left on our side now that Stripe authenticates hosts for bank details: a narrow account-link route, a step-up check that a fresh email sign-in cannot satisfy for hosts who have a factor, step-up on factor changes and invites, and an email to owners when a payout bank account changes.

**Architecture:** A second session clock, `lastFactorVerifiedAt`, is stamped only by passkey/TOTP/backup-code verification. The gate decision is a pure function of (path, body, whether the user has a factor, both clocks), tested without a database; the Better Auth hook supplies the facts. The bank-change notification plugs into the Stripe event handler's existing `onExternalAccountChanged` hook.

**Tech Stack:** Better Auth (passkey, twoFactor plugins), Postgres, Next.js, Bun test.

**Spec:** `docs/compliance/specs/2026-10-02-payout-step-up-design.md`

## Global Constraints

- Step-up window stays 15 minutes (`STEP_UP_MAX_AGE_MS`).
- `lastFactorVerifiedAt` is stamped only on success of `/passkey/verify-authentication`, `/two-factor/verify-totp`, `/two-factor/verify-backup-code`. Never at sign-in.
- A user who has a factor (a passkey, or `twoFactorEnabled`) must have a fresh factor verification for gated actions. A user with none falls back to `lastVerifiedAt`, as today.
- Gated paths, added: `/organization/invite-member`, `/passkey/generate-register-options`, `/passkey/verify-registration` (Better Auth has no `/passkey/add-passkey`), `/passkey/delete-passkey`, `/two-factor/enable`, `/two-factor/disable`, `/two-factor/generate-backup-codes`. Existing gated paths unchanged.
- Gates fail closed: an unreadable session row or a database error is a refusal.
- Freshness is read from the database, never the cookie cache.
- Account-link route: owner of the organisation only; refused with 409 once the Stripe account needs nothing; writes `audit_log` `payout.onboarding-link-created`. No step-up there (the link leads to a Stripe login).
- Bank-change email goes to every org owner; contains last4 and country, never a full IBAN. A failed email never fails the webhook.
- Enrolment stays a nudge: no required onboarding step.
- Migration file `0019_factor_stepup.sql`, hand-applied, idempotent.
- UI copy that says a passkey "protects payouts" is changed: it protects team and account changes.

## Review Focus

1. **A host with a passkey signs in by magic link and immediately invites an owner** — refused until they verify the passkey. (Task 1 tests.)
2. **A host with no factor at all** — can still enrol their first passkey and manage their team after a recent sign-in; not locked out. (Task 1 tests.)
3. **Enrolling TOTP mid-flow** — `/two-factor/enable` then `/two-factor/verify-totp` must complete even though enabling flips the user into "has a factor" (the verify path is never gated, and it stamps the factor clock). (Task 1 + manual trace.)
4. **Deleting the last passkey when TOTP is off** — the user drops back to "no factor"; the next gated action falls back to sign-in recency rather than becoming impossible. (Task 1 tests.)
5. **A manager (not owner) calls the account-link route** — 403, no link minted. (Task 3 tests.)

---

### Task 1: The gate decision

**Files:** modify `packages/auth/src/shared.ts`, `packages/auth/src/server.test.ts`; create `packages/db/drizzle/0019_factor_stepup.sql`.

**Produces:**
```ts
export function isFactorStepUpFresh(lastFactorVerifiedAt: Date | string | null | undefined, now?: Date): boolean;
/** Whether this request is allowed, given what is known about the session. */
export function stepUpSatisfied(input: { hasFactor: boolean; lastVerifiedAt: Date | string | null | undefined; lastFactorVerifiedAt: Date | string | null | undefined }, now?: Date): boolean;
```
`stepUpRequiredForRequest` gains the five new paths.

### Task 2: Wire the hook

**Files:** modify `packages/auth/src/host.ts` (session additional field; `sessionStepUpState(sessionId, userId)` reading both clocks and whether the user has a factor; before-hook uses `stepUpSatisfied`; after-hook stamps both columns), `packages/auth/README.md`.

### Task 3: Account-link route

**Files:** create `apps/business/lib/account-link-policy.ts` + test (pure decision: `{ isOwner, hasAccount, needsOnboarding } → 'ok' | 'forbidden' | 'no-account' | 'complete'`); modify `apps/business/app/api/stripe/account-link/route.ts`.

### Task 4: Bank-change notification

**Files:** create `apps/business/lib/mailing/payout-change-alert.ts` + test (pure `renderPayoutChangeAlert`); modify `apps/business/app/api/stripe/webhook/route.ts` (`onExternalAccountChanged`: audit row + email owners).

### Task 5: Step-up dialog and copy

**Files:** create `apps/business/components/security/step-up-dialog.tsx`, `apps/business/lib/use-step-up.ts`; modify `security-panel.tsx` (wrap gated calls; copy), `passkey-nudge.tsx` (copy), `apps/business/app/(dashboard)/dashboard/finance/page.tsx` (Payouts card linking to the Stripe Dashboard).

## Left for Wouter

- Apply `0019_factor_stepup.sql` before deploying.
- Add `account.external_account.created|updated|deleted` to the Connect webhook endpoint in Stripe.
- Recovery when a host has lost every factor is a manual identity check by you; there is no self-service reset beyond backup codes.

## What review changed

A reviewer ran the hooks against the real Better Auth dispatch and found the first version did not hold. Fixed, with an integration test for each (`packages/auth/src/step-up-hooks.test.ts`):

- A failed verification still started the clock (Better Auth runs after-hooks on failure).
- Passkey re-verification stamped the old session; the browser was moved to a new, unstamped one, so passkey hosts could never pass the gate.
- Someone else's passkey, presented with a victim's cookie, stamped the victim's session.
- `/two-factor/get-totp-uri` returned the authenticator secret to any session; it is now blocked.
- No limit on wrong codes from a signed-in session; now five per 15 minutes.

## Still open to a stolen session cookie

- A host with no factor, within 15 minutes of signing in, can do everything, including enrolling the thief's own factor. This is the cost of keeping enrolment optional.
- Not gated: demoting a member or promoting to `finance`/`manager`, `/organization/update`, `/organization/leave`, cancelling an invitation, revoking sessions (which can sign the real host out), unlinking a social account, renaming a passkey.
- `/admin/*` for a stolen staff session, including impersonation.
- No screen in the business app calls invite, remove or role change yet; whoever builds it must wrap those calls in `useStepUp`'s `guard`.

## Not verified

- The dialog in a real browser (WebAuthn prompt, focus). The server side is covered by the integration test with a software passkey.
- Finance shows the payout status of the user's oldest organisation, not the active one; any member role can see it.
