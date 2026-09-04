# Stripe setup — as it stands (3 Sep 2026)

A snapshot of every place Stripe touches this monorepo: the shared client, guest
checkout in `apps/web`, host onboarding in `apps/business`, the support-bot's
read-only lookups, and what is configured but not yet wired.

---

## 1. The shared package — `packages/stripe`

Single dependency: `stripe@22.6.0`. Everything server-side goes through it.

| File | Export | What it does |
|---|---|---|
| `src/client.ts` | `stripe` | Lazy singleton behind a `Proxy`. Reads `STRIPE_SECRET_KEY` on first property access (so importing the package never throws at module load), pinned to API version **`2026-08-26.dahlia`**. |
| `src/connect/accounts.ts` | `createConnectAccount` | Creates the host's connected account. |
| `src/connect/account-link.ts` | `createAccountLink` | `account_onboarding` link with refresh/return URLs. |
| `src/connect/retrieve.ts` | `retrieveConnectAccount` | Plain `accounts.retrieve`, used for live requirement checks. |
| `src/payments/status.ts` | `getPaymentSummary` | Read-only PaymentIntent + refunds summary for support. Returns `null` on `resource_missing`. Amounts in minor units. |

### Connect account shape

`createConnectAccount` hard-codes a **NL company, platform-controlled** account:

```ts
controller: {
  stripe_dashboard: { type: 'none' },      // no Express/Standard dashboard
  fees:   { payer:    'application' },     // platform pays Stripe fees
  losses: { payments: 'application' },     // platform eats disputes
  requirement_collection: 'application',   // we collect KYC, not Stripe
}
capabilities: { transfers: { requested: true } }   // payout-only, no card_payments
country: 'NL', business_type: 'company'
```

Company name, address, `registration_number` (KvK) and `tax_id` (VAT) are pushed
at creation from the onboarding form. **Only `transfers` is requested** — hosts
are deliberately payout-only, which is the constraint that shapes the whole
charge model below.

---

## 2. Guest checkout — `apps/web`

### Model: platform charge + `transfer_data.destination`

Charges are created **on the platform account**, with the host as the transfer
destination. The platform is merchant of record.

- **No `on_behalf_of`.** It would make the host MoR (and bring in their payment
  method configuration), but Stripe refuses it for an account holding `transfers`
  without `card_payments` — and the refusal lands at *confirm* time, after the
  guest has typed a card. Documented in the route.
- **No `application_fee_amount` right now.** The line is commented out;
  `platformFeeCents` is hard-coded to `0` in `_lib/booking.ts`. `properties.commission_rate`
  exists in the schema (default `0.035`) but is not read at checkout.

### Embedded Checkout Session — `app/api/checkout/route.ts` (POST, no body)

Migrated off Elements to `ui_mode: 'form'` (commits `2d78804`, `47b3816`). Returns
a `client_secret`, not a hosted URL, so the page keeps its own layout while Stripe
owns the fields, validation and pay button.

Session parameters:

- `mode: 'payment'`, `ui_mode: 'form'`
- `line_items` — one per priced row, built with inline `price_data` (room × nights,
  plus a "Tourist tax" row only when `tax_rate > 0`)
- `phone_number_collection: { enabled: true }`
- `billing_address_collection: 'required'` — also how the guest's **name** is
  collected (`name_collection` was rejected: it produces two "Full name" fields)
- `payment_method_configuration` — set from `STRIPE_PAYMENT_METHOD_CONFIGURATION`
  if present, otherwise the platform default *(uncommitted change)*
- `payment_intent_data.transfer_data.destination` — only when the booking has a
  connected account
- `metadata` — `bookingIntentId`, `roomId`, `totalCents`
- `return_url` — `${NEXT_PUBLIC_APP_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`
- `expires_at` — 30-minute room hold, clamped into Stripe's 30 min–24 h window
  with a 60 s margin on both ends

Pre-flight validation (`assertChargeable`) rejects, *before* calling Stripe: empty
line sets, non-integer/negative amounts, bad quantities, totals under a per-currency
minimum (`eur/usd/chf 50`, `gbp 30`, `sek/nok 300`, `dkk 250`), and — on Connect
bookings — a fee that is negative or ≥ the total.

The response is `{ clientSecret, expiresAt }` with `Cache-Control: no-store`.

### Client — `app/checkout/_components/`

- `CheckoutClient.tsx` — loads Stripe.js from `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  (once per page load), fetches the session and mounts `CheckoutFormProvider` from
  `@stripe/react-stripe-js/checkout`, keyed on the client secret so a retry gets a
  clean provider. Session creation is aborted on unmount so React's dev double-mount
  doesn't leave an orphaned session holding the room.
- `PaymentCard.tsx` — renders `<CheckoutForm layout="expanded">` and nothing else.
  Express wallets: **Link and Amazon Pay set to `never`**; Apple/Google Pay left on.
  Confirms via `checkout.confirm({ formConfirmEvent })`. Tracks the hold with a
  timer that re-checks the wall clock on `visibilitychange` (background tabs throttle
  timers). Takes over the card for `expired` / `complete` sessions so a back button
  can't invite a second payment.
- `_lib/appearance.ts` — Appearance API built from computed CSS tokens, browser-only.
- `_lib/errors.ts` — the error contract. Raw Stripe messages never reach the guest;
  a `CheckoutErrorCode` (`config_error`, `booking_invalid`, `session_failed`,
  `stripe_unreachable`, `rate_limited`) maps to copy plus a `retryable` flag. A
  table maps ~25 Stripe API codes onto those five, plus decline-code wording.

### Return page — `app/checkout/return/page.tsx`

Server component; retrieves the session with `expand: ['payment_intent']` and maps
to one of six outcomes: `paid`, `processing`, `failed`, `expired`, `unverified`,
`unknown`. The governing rule: only a session Stripe still reports as `open` may
tell the guest they weren't charged; every other uncertain path lands on
`unverified` rather than risking a double payment. Unknown statuses go to Sentry.

### Booking data — `app/checkout/_lib/booking.ts`

Reads a **single seeded booking** (`b0000000-…-000000000001`) — there is no
booking-intent table yet. One SQL round trip joins property, reservation, room,
rate plan and lateral image lookups. Schema money is in **major** units; `toCents`
is the only conversion, at the Stripe boundary. The page and the session route both
call `getBookingSummary`, so what the guest reads and what Stripe charges come from
the same rows. `stripe_account_id` falls back to `STRIPE_CONNECT_ACCOUNT_ID` because
the seeded property has none.

### CSP — `apps/web/next.config.ts`

`js.stripe.com` + `*.js.stripe.com` (script/frame), `hooks.stripe.com`,
`api.stripe.com` (connect), `*.stripe.com` (img), and `link.com`/`*.link.com`
— the Link entries can be dropped now that Link is off.

---

## 3. Host onboarding — `apps/business`

Steps: `core-info → address → legal → stripe`.

1. `provisionStripeAccount()` (server action) — idempotent; returns the existing id
   from `host_onboarding.step_data->>'stripe_account_id'` or creates the account and
   upserts the id via `jsonb_build_object`.
2. `POST /api/stripe/account-link` — auth-gated, looks up the stored account id and
   returns a fresh `account_onboarding` URL (refresh and return both → `/onboarding/stripe`).
3. `_lib/status.ts` — calls `retrieveConnectAccount` live on each load to read
   `currently_due` and `charges_enabled`.
4. `_steps/verify.tsx` — polls status, sends the host to Stripe while requirements
   are due, shows "Stripe is reviewing" while `!chargesEnabled`, completes otherwise.
5. `POST /api/stripe/webhook` — verifies with `STRIPE_WEBHOOK_SECRET`, handles
   **`account.updated` only**: when `currently_due` is empty and `charges_enabled`,
   stamps `host_onboarding.onboarding_completed_at`.

CSP additionally allows `connect-js.stripe.com` (Connect.js is permitted but not
yet used in code).

Marketing note: `components/business/CostCalculator.tsx` quotes Stripe at
1.5 % + €0.25 — display copy, not integration config.

---

## 4. Support bot — `apps/support-bot`

Read-only. `agent/tools.ts` takes `bookings.stripe_payment_intent_id` and calls
`getPaymentSummary` for status, amount, refunds and dispute flag. `STRIPE_SECRET_KEY`
is listed in the required env but consumed inside `@openbookings/stripe`, not `env.ts`.

---

## 5. Database

| Table.column | Note |
|---|---|
| `properties.stripe_account_id` | `varchar(255)`, unique — the connected account |
| `properties.commission_rate` | `numeric(5,4)`, default `0.035` — **not read at checkout** |
| `bookings.stripe_payment_intent_id` | `varchar(255)`, indexed — **nothing writes it yet** |
| `transactions.*` | `provider` defaults `'stripe'`, `provider_payment_id`, status/failure columns — **table unused so far** |
| `host_onboarding.step_data->>'stripe_account_id'` | where the connected account id actually lives during onboarding |

---

## 6. Environment variables

| Variable | web | business | support-bot |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ `sk_test_…` | ✅ `sk_test_…` | ✅ `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ `pk_test_…` | ✅ | — |
| `STRIPE_CONNECT_ACCOUNT_ID` | ✅ `acct_…` (seed fallback) | — | — |
| `STRIPE_PAYMENT_METHOD_CONFIGURATION` | ✅ `pmc_…` | — | — |
| `STRIPE_WEBHOOK_SECRET` | — | **referenced but not in `.env.local`** | — |
| `NEXT_PUBLIC_APP_URL` | required in production (localhost:3002 fallback in dev) | — | — |

Everything is **test mode** today.

---

## 7. Gaps and open items

- **No payment webhook anywhere.** `constructEvent` appears once, for `account.updated`.
  Nothing listens for `checkout.session.completed` / `payment_intent.succeeded`, so
  `bookings.status` stays `pending`, `stripe_payment_intent_id` is never written, and
  no `transactions` row is created. The return page is currently the only place a
  payment outcome is observed — and it's client-navigation-dependent.
- **Platform fee disabled.** `platformFeeCents` is `0`; `application_fee_amount` is
  commented out. The validation that guards it is already in place.
- **`STRIPE_WEBHOOK_SECRET` missing** from `apps/business/.env.local` — the webhook
  route will throw/reject signatures locally.
- **Checkout is pinned to one seeded booking id**; no booking-intent table yet.
- **Confirmation email** is promised by the `paid` copy but not sent from any Stripe path.
- **No idempotency keys** on session creation.
- Link CSP entries in `apps/web/next.config.ts` are now dead weight.

### Uncommitted work in the tree

- `api/checkout/route.ts` — adds `resolvePaymentMethodConfiguration()` and the
  `on_behalf_of` rationale comment.
- `checkout/_components/TripSummary.tsx` — visual only: co-branded logo lockup,
  16:9 room photo, drops the location label.
- `sentry.{client,edge,server}.config.ts` — 3 lines each, unrelated to Stripe.
