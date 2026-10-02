# Payout safety and step-up — design

**Date:** 2 October 2026
**Closes:** audit F2a (payout changes), F2c (`invite-member` not gated)
**Depends on:** `2026-10-02-stripe-full-dashboard-design.md`
**Status:** approved, not yet implemented

## How the Stripe change moves the problem

The audit finding was that a stolen host session could open a Stripe link and
redirect payouts. That was true for the current accounts, where Stripe leaves
authentication to the platform.

With full-dashboard accounts Stripe authenticates the host itself. Onboarding
and every later change to bank details happen behind the host's own Stripe
login and Stripe's 2FA. An OpenBookings session, stolen or not, cannot reach
payout details. So the payout gate is Stripe's, and this spec covers what is
left on our side:

1. keep our one Stripe route narrow,
2. fix the two weaknesses in the step-up base layer, which still guards team
   and account changes,
3. tell owners when a bank account changes.

## Decisions (agreed with Wouter)

| Decision | Choice |
|---|---|
| What counts as verified | A real factor (passkey, TOTP, backup code) within 15 minutes, for users who have one. |
| Enrolment | A nudge, not a requirement. No extra onboarding step. |
| Payout details after onboarding | Managed in the host's Stripe Dashboard. Finance links there. |
| After a bank account change | Email all org owners and write `audit_log`. No payout hold. |

## Design

### 1. The account-link route

`POST /api/stripe/account-link`:

1. Session check (unchanged).
2. Caller must be an `owner` of the organisation.
3. Only while onboarding is incomplete or Stripe has requirements due. Once
   the account is fully onboarded the route returns 409; there is nothing for
   it to do.
4. `audit_log` row, `action: 'payout.onboarding-link-created'`.

No step-up check here: the link leads to a Stripe login, and a factor prompt
before a second login adds friction without adding protection.

### 2. Two assurance levels

`session."lastVerifiedAt"` is stamped at every sign-in, and hosts sign in by
magic link or OAuth, so "fresh" can mean "clicked an email link". Add a second
clock:

- `session."lastFactorVerifiedAt"` — nullable, stamped **only** on success of
  `/passkey/verify-authentication`, `/two-factor/verify-totp` or
  `/two-factor/verify-backup-code`. Never at sign-in.

Migration `packages/db/drizzle/0017_factor_stepup.sql` (hand-applied,
idempotent):

```sql
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "lastFactorVerifiedAt" timestamptz NULL;
```

`packages/auth/src/shared.ts` gains `isFactorStepUpFresh`. The after-hook in
`packages/auth/src/host.ts` writes both columns on a refresh path.

### 3. Gate levels on auth endpoints

`stepUpRequiredForRequest` returns a level instead of a boolean, and the
before-hook resolves it against the database:

- User **has** a factor → `lastFactorVerifiedAt` must be fresh.
- User has **no** factor → `lastVerifiedAt` must be fresh (today's behaviour;
  with nothing enrolled, a recent sign-in is the only bar available).

Paths gated:

- existing: `/organization/delete`, `/organization/remove-member`,
  `/change-email`, `/delete-user`, promotion to owner/admin;
- new: `/organization/invite-member` (closes F2c);
- new: `/passkey/add-passkey`, `/passkey/delete-passkey`,
  `/two-factor/enable`, `/two-factor/disable`. Today a stolen session can
  enrol its own passkey and then satisfy the gate with it.

### 4. Client: one step-up dialog

`apps/business/components/security/step-up-dialog.tsx` and a `useStepUp()`
hook around auth-client calls. On 403 `STEP_UP_REQUIRED`:

- with a factor: passkey first, then authenticator code, then recovery code;
  on success retry the original call once;
- without a factor: explain that the session is too old for this action and
  offer to sign in again.

Today the security panel and member management surface the raw error message.

### 5. Finance: payout details

`apps/business/app/(dashboard)/dashboard/finance/page.tsx` keeps `ComingSoon`
for statements and adds a "Payouts" card: `payouts_enabled`, any requirements
Stripe has due, and an "Open Stripe Dashboard" link to
`https://dashboard.stripe.com`. No link is minted and no bank details are
shown or stored by us.

Copy in `security-panel.tsx:188` and `passkey-nudge.tsx:42` currently says a
passkey protects payouts. That is no longer what it does; change both to
"protects your team and account changes".

### 6. Detect and notify

On the Connect webhook endpoint (Stripe spec §5), for
`account.external_account.created`, `.updated`, `.deleted`:

- dedupe on `event.id` via `processed_events`;
- resolve the organisation from `event.account`;
- `audit_log` row, `action: 'payout.external-account-changed'`, with bank
  last4 and country in `detail`, never a full IBAN;
- email every org owner through the existing `sendSecurityAlert` path: what
  changed, when, last4, and what to do if it was not them (secure the Stripe
  account, contact support).

This is the one control that still catches a takeover of the host's Stripe
login, which we cannot prevent.

### 7. Recovery

Backup codes are the self-service path. A host who has lost every factor can
still sign in; gated actions then need a manual identity check by Wouter
before factors are cleared. The security panel says so.

## Error handling

- Gates fail closed: a missing session row or a database error is a 403.
- A failed notification email does not fail the webhook; log and return 200.
- The dialog retries once; a second 403 shows the error.

## Testing

- `isFactorStepUpFresh`; the level function for every gated path, with and
  without a factor; fail-closed cases.
- Hook: sign-in stamps only `lastVerifiedAt`; each refresh path stamps both.
- Account-link route: no session, non-owner, onboarded account (409), happy
  path, audit row.
- Webhook: dedupe, audit row, one email per owner.

## Out of scope

- A required enrolment step in onboarding.
- Requiring a factor at sign-in for hosts who have one. Worth doing later: it
  is what actually closes mailbox takeover for everything in the portal.
- Payout holds.
