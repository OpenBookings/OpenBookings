# Handoff: review the commission model after the Stripe full-dashboard change

Date: 2 October 2026
Branch: `compliance/remediation` (PR https://github.com/OpenBookings/OpenBookings/pull/90, against `main`)

## What you are being asked to do

Review whether OpenBookings' commission model, host-facing copy and legal text are still consistent after PR #90 moved payments to full-dashboard Stripe accounts with direct charges. Report findings and proposed fixes; do not change code or the PR without Wouter's go-ahead.

## Background

Wouter (the founder) set up Stripe's Platform pricing tool in the Stripe dashboard. The rule takes 4.5% plus the going transaction cost per payment method, so 4.5% + €0.29 for iDEAL. He assumed that rule collects the commission.

PR #90 changes the payment model so that rule no longer fires:

- Connected accounts are created with a full Stripe dashboard, `fees: { payer: 'account' }` and `losses: { payments: 'stripe' }` (`packages/stripe/src/connect/accounts.ts:35-39`).
- Checkout uses direct charges on the host's account.
- Commission is taken in code as an `application_fee_amount` (`packages/stripe/src/payments/checkout.ts:69`), calculated as a flat percentage with no fixed component (`packages/stripe/src/payments/fees.ts`).
- The fee is behind `STRIPE_APPLICATION_FEE_ENABLED`, default off (`apps/web/app/checkout/_lib/booking.ts`). With the flag off, no commission is collected at all.
- Commission is refunded proportionally on `charge.refunded` (`packages/stripe/src/payments/commission-refund.ts`).

Stripe's docs (https://docs.stripe.com/connect/platform-pricing-tools) say the pricing tool applies only when the platform is the fee payer (`controller.fees.payer = application`, or destination charges) and the payment carries no explicit application fee. They also say configured pricing does not apply to direct charges on Standard accounts.

## What changed for the business

| | Old (pricing tool) | New (PR #90) |
|---|---|---|
| Platform collects | 4.5% + €0.29, then pays Stripe the €0.29 | 4.5%, nothing owed to Stripe |
| Stripe's processing fee | Charged to the platform, passed on to the host | Charged to the host directly |
| Chargebacks and negative balances | Platform's liability | Stripe's and the host's |
| Guest money | Held 7 days after checkout, then paid out | In the host's Stripe balance at booking |
| Commission base | Room subtotal, excluding tourist tax | Full guest price, including tax |
| Refunds | Not established | Commission returned proportionally; Stripe keeps its fee, host bears it |

## Already updated in the PR

- `apps/docs/content/docs/business/getting-paid/how-commission-works.mdx`
- `apps/docs/content/docs/business/getting-paid/when-you-get-paid.mdx`
- `apps/docs/content/docs/business/getting-paid/disputes-and-chargebacks.mdx`
- The payout troubleshooting article (`my-payout-hasnt-arrived.mdx`)
- One FAQ answer about who holds the money (`apps/business/components/business/FAQ.tsx:27`)

## Open questions to review

1. **Stripe docs reading.** The pricing tool page was read through an extraction tool that returned fragments. Read the "Controller property configurations" section in full and confirm the tool cannot apply to full-dashboard accounts with `fees.payer: 'account'` on direct charges.
2. **Existing connected accounts.** Check whether any live accounts were created under the old setup. The pricing tool rule still applies to those, and they would need migrating. `packages/stripe/scripts/discard-test-accounts.ts` suggests only test accounts exist, but this is unverified.
3. **The flag.** `STRIPE_APPLICATION_FEE_ENABLED` is not in any `.env` example, turbo config or CI. Confirm it must be `true` in production and decide whether a default-off flag for revenue is acceptable, or whether it should fail loudly when unset in production.
4. **FAQ wording** (`apps/business/components/business/FAQ.tsx:9`). It says Stripe's processing "is passed through at cost" and that hosts "see both lines separately on every payout". Under the new model Stripe charges the host directly. Check whether "around 6%" still holds across payment methods.
5. **Cost Calculator** (`apps/business/components/business/CostCalculator.tsx`, `packages/pricing/src/calculator.ts`). Check which base it applies 4.5% to (subtotal or tax-inclusive total) and whether it models Stripe's fee the way the new setup charges it.
6. **Platform agreement and other legal text.** The old FAQ pointed to the platform agreement for the 7-day reconciliation period. No platform agreement file was found by filename; locate it and check for references to the 7-day hold, the commission base, and who pays processing fees.
7. **30 days' notice.** The docs promise 30 days' notice for rate changes. Decide whether the wider commission base and the move from the old 3.5% code default to 4.5% (`packages/db/drizzle/0018_commission_default.sql`) trigger that for any host already live.
8. **Loss of the 7-day hold.** The platform can no longer withhold a payout over a cancellation or dispute. Check that cancellation, refund and dispute flows do not assume it can.
9. **Design choice.** Confirm keeping the code-based fee is right, as opposed to relying on the pricing tool (which would need the platform to pay Stripe's fees and give up the full dashboard). The design spec is `docs/compliance/specs/2026-10-02-stripe-full-dashboard-design.md`.

## Known inaccuracy to fix

The PR #90 description lists eight environment variables as if new. Only `STRIPE_APPLICATION_FEE_ENABLED` is new; the rest already exist on `main`. Behaviour changed for the MapTiler variables (now effectively required, no Carto fallback) and `STRIPE_CONNECT_ACCOUNT_ID` (now a dev-only fallback).
