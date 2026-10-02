# Stripe setup: full dashboard and direct charges — design

**Date:** 2 October 2026
**Affects:** audit A1, A3, A5, A7, A8, F2a; doc drift #1, #10
**Status:** approved, not yet implemented

## Decisions (from Wouter)

- Hosts get the full Stripe Dashboard. The current accounts
  (`stripe_dashboard: none`, platform-collected requirements) are replaced.
- Bookings use direct charges on the host's account, with an application fee
  to OpenBookings.
- Only test accounts exist today. They are discarded; no migration path.

## What the dashboard choice forces

Per Stripe's controller rules, `stripe_dashboard.type = 'full'` is not
compatible with `application` for losses, fees or requirement collection. So:

| Property | Today | After |
|---|---|---|
| `controller.stripe_dashboard.type` | `none` | `full` |
| `controller.requirement_collection` | `application` | `stripe` |
| `controller.losses.payments` | `application` | `stripe` |
| `controller.fees.payer` | `application` | `account` |

Consequences:

- Stripe collects and re-collects KYC. Stripe authenticates the host (their
  own Stripe login and 2FA) for onboarding and for every later change,
  including bank details.
- The host pays Stripe's processing fees and is liable for their own disputes
  and negative balances.
- The dashboard type cannot be changed on an existing account. New accounts
  only.

## Design

### 1. Account creation — `packages/stripe/src/connect/accounts.ts`

```ts
stripe.accounts.create({
  controller: {
    stripe_dashboard: { type: 'full' },
    requirement_collection: 'stripe',
    losses: { payments: 'stripe' },
    fees: { payer: 'account' },
  },
  country: hostData.country,
  email: hostData.email,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  // prefill only; the host confirms or corrects it in Stripe onboarding
  business_profile: { name: hostData.legalCompanyName },
})
```

- `country` comes from the host's data, not a hardcoded `'NL'` (closes A8).
- `business_type: 'company'` is no longer hardcoded; the host chooses in
  Stripe onboarding, which makes individual sellers reachable.
- Company address, registration number and tax id are no longer sent. With
  Stripe collecting requirements, the host enters them in Stripe; our copies
  stay in `org_profile` for our own records.
- Local payment-method capabilities (iDEAL, Bancontact) are requested
  automatically by country for full-dashboard accounts.

### 2. Onboarding link

`createAccountLink` stays `type: 'account_onboarding'`. The host signs in to
or creates a Stripe account on Stripe's side. `account_update` links do not
exist for this configuration; later changes happen in the host's own Stripe
Dashboard.

Onboarding completion keeps the current rule (`currently_due` empty and
`charges_enabled`), and additionally checks `payouts_enabled` before the
property can go live.

### 3. Checkout — direct charge

`apps/web/app/api/checkout/route.ts`:

- Create the Checkout Session on the connected account:
  `stripe.checkout.sessions.create(params, { stripeAccount: booking.stripeAccountId })`.
- Remove `transfer_data`. Add
  `payment_intent_data.application_fee_amount: booking.platformFeeCents`.
- A booking with no connected account, or one where `charges_enabled` is
  false, is refused with a checkout error. There is no fallback to charging on
  the platform, and the `STRIPE_CONNECT_ACCOUNT_ID` env fallback in
  `booking.ts:331` is limited to development.
- Payment methods: the session now uses the connected account's payment
  method configuration. `resolvePaymentMethodConfiguration` and its comment
  (which says the connected-account preset is dormant) are updated; the
  platform's "connected accounts" preset becomes the one that matters.
- Return the connected account id to the browser with the client secret.

`apps/web/app/checkout/_components/CheckoutClient.tsx`: Stripe.js must be
initialised for the connected account (`loadStripe(pk, { stripeAccount })`).
The module-level `stripePromise` becomes per-account, created once the session
response arrives.

`apps/web/next.config.ts` CSP: no change expected; verify in the browser.

### 4. Application fee

The rate is 4.5% (decided; Wouter has already updated the rows in the
database).

`booking.platformFeeCents` is computed from `properties.commission_rate`,
which becomes the single authoritative rate (closes audit E4), applied to the
full guest price (rates are tax-inclusive, see that spec).

The code still carries the old number and is brought in line:

- `packages/db/src/schema.ts:89` and `apps/web/sql/ddl.sql:195` — column
  default `0.035` → `0.045`, with a hand-applied
  `ALTER TABLE properties ALTER COLUMN commission_rate SET DEFAULT 0.045`.
- `packages/db/seed/demo-booking.ts` — `BOOKING_FEE_RATE`.
- `apps/business/lib/analytics/derive/totals.ts:4` and `CostCalculator.tsx:6`
  keep 4.5% but as display constants only; the analytics figure reads the
  property's rate where it has one.
- `rate_plans.booking_fee_rate` (unused second fee column) is left alone and
  marked unused in a comment.
- `how-commission-works.mdx:21` — remove the warning callout about the
  3.5% / 4.5% discrepancy.

The fee ships behind `STRIPE_APPLICATION_FEE_ENABLED` (default off) so the
direct-charge model can be verified in test mode before commission is live.

Hosts now also pay Stripe's processing fee out of the booking amount. That is
a change in what hosts receive and is stated in the commission docs (§7).

### 4b. Refunds return the commission

Rule (from Wouter): if the booking did not happen, OpenBookings does not earn.

Hosts refund from their own Stripe Dashboard, where the platform's application
fee is **not** returned by default. So the platform returns it itself: on
`charge.refunded` (Connect webhook, §5) the handler refunds the application
fee in proportion to the amount refunded
(`stripe.applicationFees.createRefund`), so a full refund returns the whole
fee and a 50% refund returns half.

- Idempotent: dedupe on `event.id`, and compare against the fee's
  `amount_refunded` so a redelivered or repeated event never over-refunds.
- A lost dispute is treated the same way: on `charge.dispute.closed` with
  status `lost`, the remaining fee is returned.
- Written to `audit_log` (`action: 'commission.refunded'`).

### 5. Webhooks

Events for direct charges fire on the connected account, so they arrive on a
Connect webhook endpoint with `event.account` set.

- Add a Connect endpoint (separate signing secret,
  `STRIPE_CONNECT_WEBHOOK_SECRET`) in `apps/business/app/api/stripe/`.
- Handle: `account.updated` (moved here), `account.external_account.created`
  / `.updated` / `.deleted` (see step-up spec), `checkout.session.completed`,
  `charge.refunded`, `charge.dispute.created` / `.closed`.
- Every handler dedupes on `event.id` via `processed_events` (closes A7).
- Dispute and refund handlers record state on the booking and notify the
  host; they do not move money. The host answers disputes in their dashboard.

Booking creation from `checkout.session.completed` is out of scope here: the
checkout is still pinned to a seeded booking. The handler is added with the
dedupe and a logged no-op so the endpoint is correct when bookings become real.

### 6. Reads on connected accounts

`packages/stripe/src/payments/status.ts` (`getPaymentSummary`, used by the
support bot) retrieves a payment intent on the platform. Payment intents now
live on the host's account, so it takes the connected account id and passes
`{ stripeAccount }`. Callers look the account up from the booking's property.

### 7. Things that become the host's, and the docs that must change

| Topic | Now |
|---|---|
| Payout schedule (A1) | Set by the host in their dashboard; Stripe default applies. We set nothing. |
| Refunds (A4) | Issued by the host from their dashboard. A platform-initiated refund path stays unbuilt. |
| Disputes (A5) | The host is liable and responds in their dashboard. |
| Bank details (F2a) | Changed in the host's Stripe Dashboard behind Stripe's login. |

Published text that contradicts this is rewritten in the same change, to
describe the setup in this spec and nothing more:

- `getting-paid/disputes-and-chargebacks.mdx` — replaces "the platform
  absorbs disputes" with: disputes are raised against the host's Stripe
  account, the host responds in their Stripe Dashboard, and OpenBookings
  returns its commission if the dispute is lost.
- `somethings-not-right/my-payout-hasnt-arrived.mdx`,
  `getting-paid/when-you-get-paid.mdx`, `components/business/FAQ.tsx` —
  removes the 7-day hold "by the platform". Payments land in the host's own
  Stripe balance and are paid out on the schedule set in their Stripe
  Dashboard; OpenBookings never holds the funds.
- `getting-paid/how-commission-works.mdx` — 4.5% on the booking total, taken
  at payment; Stripe's processing fee is paid by the host; commission is
  returned on refunds.
- `start-here/set-up-your-property.mdx` and the onboarding Stripe step copy —
  the host creates or connects their own Stripe account with full dashboard
  access.
- Any remaining statement that hosts have no Stripe dashboard.

The Partner Agreement text itself is not in this repo as a document (only
references to it in onboarding, the FAQ and `org_consent`). Its wording on
commission base, Stripe fees, disputes, refunds and tax-inclusive rates has to
be updated by Wouter; hosts who signed the old wording need the new one.

### 8. Discarding the test accounts

One-off script: list connected accounts in test mode, delete them, and clear
`host_onboarding.step_data->>'stripe_account_id'`,
`properties.stripe_account_id` and `org_profile.stripe_account_id`. Affected
test hosts land back on the Stripe onboarding step.

### 9. Stripe Dashboard settings (manual, by Wouter)

- Connect settings: allow connected accounts with full dashboard access;
  set platform branding for onboarding.
- Payment method settings → "Your connected accounts": enable the methods
  hosts should offer by default (cards, iDEAL, Bancontact).
- Create the Connect webhook endpoint and store its secret.

## Testing

- `createConnectAccount` sends the new controller block and the host's country.
- Checkout route: session created with `stripeAccount`; no `transfer_data`;
  fee present only when the flag is on; refusal when the account is missing or
  cannot charge.
- Connect webhook: signature, `event.account` resolution, dedupe.
- `getPaymentSummary` passes the connected account.
- End to end in test mode: onboard a host, pay a booking with a test card,
  confirm the payment appears in the host's dashboard and the fee on the
  platform.

## A later move to Adyen or Mollie

The move is wanted but not possible yet, so this work goes ahead on Stripe.
To keep the later swap contained:

- Stripe calls stay inside `packages/stripe`. The checkout route, webhook
  handlers and Finance page call named functions from that package
  (`createBookingCheckout`, `refundCommission`, `getPayoutStatus`), not the
  Stripe SDK directly. The checkout route's inline `sessions.create` moves
  into the package as part of this change.
- Booking and audit rows store provider-neutral fields (`payment_provider`,
  `provider_payment_id`, `provider_account_id`) rather than new
  Stripe-named columns.
- The rules that are business decisions, not Stripe features, are written
  down here so they carry over: 4.5% on the full price, commission returned
  on refund, host is the merchant, platform never holds funds.

No abstraction layer or second provider is built now.

## Open items for Wouter

1. Partner Agreement wording (see §7).
2. `status-bar.tsx:95` tells hosts a migration to Adyen is in progress and
   that "payouts continue as usual". Since the move is not happening yet,
   this change removes that banner.
