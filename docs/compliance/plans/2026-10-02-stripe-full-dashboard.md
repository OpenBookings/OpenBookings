# Stripe Full Dashboard and Direct Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Written for native execution in the session that wrote it: each task names its files, interfaces and test cases; code is written test-first during execution rather than duplicated here.

**Goal:** Hosts get their own full Stripe Dashboard; bookings are charged directly on the host's account with a 4.5% application fee to OpenBookings that is returned when a booking is refunded.

**Architecture:** Every Stripe call lives in `packages/stripe` behind named functions; apps never touch the SDK. Money maths (fee, proportional fee refund) are pure functions with tests. The existing business webhook route is already the Connect endpoint (it receives `account.updated` for connected accounts), so it gains the new handlers and event dedupe rather than a second endpoint.

**Tech Stack:** Stripe Node SDK (API `2026-08-26.dahlia`), Next.js route handlers, Postgres, Bun test.

**Spec:** `docs/compliance/specs/2026-10-02-stripe-full-dashboard-design.md`

## Global Constraints

- Controller, verbatim: `stripe_dashboard.type: 'full'`, `requirement_collection: 'stripe'`, `losses.payments: 'stripe'`, `fees.payer: 'account'`.
- `country` comes from the host's data; `business_type` is not sent.
- Direct charges: the Checkout Session is created with `{ stripeAccount }`; no `transfer_data`, no `on_behalf_of`.
- Commission is 4.5% of the full guest price, from `properties.commission_rate`. Column default becomes `0.045`.
- The fee is sent only when `STRIPE_APPLICATION_FEE_ENABLED === 'true'` (default off).
- Refunds return commission in proportion to the amount refunded; a lost dispute returns what remains. Never more than the fee collected.
- No booking is charged on the platform account. A property with no connected account is refused (`config_error`); the `STRIPE_CONNECT_ACCOUNT_ID` fallback works only outside production.
- Every webhook handler dedupes on `event.id` via `processed_events`.
- Webhook handlers record and notify; they never move the host's money. The only money this code moves is OpenBookings' own fee, back to the host.
- No full IBAN, card data or webhook body is logged.
- Stripe calls stay inside `packages/stripe` (containment for a later move to Adyen or Mollie).
- The account-link return URLs are built from the configured public base URL, not from `req.url` (behind the production proxy that is the container's bind address).

**Deviation from the spec, on purpose:** the spec adds a second, Connect-specific webhook endpoint with its own secret. The existing `/api/stripe/webhook` already receives connected-account events, so it is that endpoint; adding a second would mean two secrets and split handling for no gain.

## Review Focus

1. **A booking is refunded twice in part (50%, then the rest)** — commission returned totals exactly the fee, never more. (Task 2 tests.)
2. **Stripe redelivers `charge.refunded`** — no second fee refund. (Task 2 maths is idempotent by construction; Task 5 dedupe.)
3. **A property with no connected account, or one that cannot take charges, reaches checkout** — refused before Stripe is called, with copy that does not invite retry. (Task 4.)
4. **Fee flag off** — no `application_fee_amount` is sent at all (Stripe rejects a zero fee on some configurations and a present-but-zero field changes reporting). (Task 3 tests.)
5. **Rounding** — fee on odd totals rounds half up to whole cents and is always below the total. (Task 2 tests.)

---

### Task 1: Account creation and onboarding link

**Files:** modify `packages/stripe/src/connect/accounts.ts`, `account-link.ts`; create `packages/stripe/src/connect/accounts.test.ts`; modify `apps/business/app/api/stripe/account-link/route.ts`, `apps/business/app/(onboarding)/onboarding/actions.ts` (pass country, email), `_steps/verify.tsx` + `webhook/route.ts` (require `payouts_enabled`).

**Produces:**
```ts
export function buildConnectAccountParams(host: { email: string; legalCompanyName: string; country: string }): Stripe.AccountCreateParams;
export function createConnectAccount(host: { email: string; legalCompanyName: string; country: string }): Promise<string>;
```
**Tests:** params carry the exact controller block; country upper-cased from host data; empty country throws (no silent `NL`); no `business_type`, no `company`; `card_payments` and `transfers` requested.

### Task 2: Fee maths

**Files:** create `packages/stripe/src/payments/fees.ts`, `fees.test.ts`.

**Produces:**
```ts
/** Commission in minor units; 0 when the rate is 0. Always < totalCents. */
export function applicationFeeCents(totalCents: number, rate: number): number;
/** How much more of the fee to return, given the charge's refund state. */
export function commissionRefundDue(input: { chargeAmount: number; chargeRefunded: number; feeAmount: number; feeRefunded: number; lostDispute?: boolean }): number;
```
**Tests:** 4.5% of 55500 = 2498 (half-up from 2497.5); rate 0 → 0; invalid rate (negative, ≥ 1, NaN) throws; full refund returns whole fee; 50% then 100% returns half then the rest; redelivery returns 0; lost dispute returns everything left; never negative, never above `feeAmount - feeRefunded`; `chargeAmount` 0 → 0.

### Task 3: Direct-charge checkout in the package

**Files:** create `packages/stripe/src/payments/checkout.ts`, `checkout.test.ts`; export from `index.ts`.

**Produces:**
```ts
export type BookingCheckoutInput = { stripeAccountId: string; customerEmail: string; currency: string; lines: { name: string; description: string; unitAmountCents: number; quantity: number }[]; applicationFeeCents: number | null; metadata: Record<string, string>; returnUrl: string; expiresAt: number; paymentMethodConfiguration?: string };
export function buildBookingCheckoutParams(input: BookingCheckoutInput): Stripe.Checkout.SessionCreateParams;
export function createBookingCheckout(input: BookingCheckoutInput): Promise<{ id: string; clientSecret: string; expiresAt: number }>;
```
**Tests:** no `transfer_data`/`on_behalf_of`; fee present only when a positive number; null or 0 fee → no `payment_intent_data.application_fee_amount`; lines map one for one; empty account id throws.

### Task 4: Web checkout uses it

**Files:** modify `apps/web/app/api/checkout/route.ts`, `apps/web/app/checkout/_lib/booking.ts` (commission rate → `platformFeeCents`; `chargesEnabled` not looked up here — Stripe's own refusal is classified), `apps/web/app/checkout/_components/CheckoutClient.tsx` (Stripe.js per connected account), `apps/web/app/checkout/_lib/errors.ts` if copy needs it.

- Response gains `stripeAccountId`; client calls `loadStripe(pk, { stripeAccount })`.
- No connected account → `config_error` before any Stripe call.

### Task 5: Webhooks

**Files:** modify `apps/business/app/api/stripe/webhook/route.ts`; create `packages/stripe/src/payments/commission-refund.ts`, `packages/stripe/src/webhooks.ts` (`constructWebhookEvent`), `apps/business/lib/stripe-events.ts` (`claimEvent(eventId)` over `processed_events`).

Handles: `account.updated`; `checkout.session.completed` (deduped, logged no-op until bookings are real rows); `charge.refunded` and `charge.dispute.closed` (status `lost`) → `refundCommissionForCharge`; `charge.dispute.created` → `audit_log`.

### Task 6: Reads on connected accounts

**Files:** modify `packages/stripe/src/payments/status.ts` (`getPaymentSummary(paymentIntentId, stripeAccountId)`), `packages/db/src/support.ts` (select the property's `stripe_account_id`), `apps/support-bot/src/agent/tools.ts` and its tests.

### Task 7: Commission default, docs, banner, test accounts

**Files:** create `packages/db/drizzle/0018_commission_default.sql`; modify `packages/db/src/schema.ts`, `apps/web/sql/ddl.sql`, `packages/db/seed/demo-booking.ts`; rewrite `disputes-and-chargebacks.mdx`, `when-you-get-paid.mdx`, `how-commission-works.mdx`, `my-payout-hasnt-arrived.mdx`, the payouts answer in `FAQ.tsx`; remove the Adyen item in `status-bar.tsx`; create `packages/stripe/scripts/discard-test-accounts.ts` (refuses to run with a live key; not run by this plan).

## Left for Wouter

- Stripe Dashboard: allow full-dashboard connected accounts; enable cards, iDEAL and Bancontact for connected accounts; add the new event types to the existing Connect webhook endpoint.
- Apply `0018_commission_default.sql`.
- Run `discard-test-accounts.ts` against test mode when ready (it deletes connected accounts).
- Set `STRIPE_APPLICATION_FEE_ENABLED=true` once direct charges are verified in test mode.
- Partner Agreement wording: commission on the full guest price, Stripe fees paid by the host, disputes handled by the host, commission returned on refund.
- **Verify the webhook endpoint in Stripe is a Connect endpoint** ("Events on Connected accounts"), subscribed to `account.updated`, `account.external_account.*`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. If it is scoped to your own account, none of these arrive and commission is never returned. The code cannot tell which it is.
- Set `NEXT_PUBLIC_BUSINESS_URL` in development (`http://business.localhost:3001`); without it Stripe returns hosts to production after onboarding.
- The host docs describe the commission as live. Turn `STRIPE_APPLICATION_FEE_ENABLED` on before any real host is onboarded, or the docs are wrong in the host's favour.

## Known gaps after review

- A commission refund is not reversed if the guest refund it followed later fails at the bank.
- Refund and dispute events are written to `audit_log` only; they do not update the booking row or notify the host (the spec asked for both). Bookings are not real rows yet.
- The return page finds the connected account through the one seeded booking. When checkout stops being pinned, the account has to be stored with the session.
- Audit rows use `stripeAccountId` and `chargeId` rather than provider-neutral names.
- Not checked in a browser: Stripe.js initialised with a connected account against this checkout form, and which error Stripe returns for an account that cannot take charges.
