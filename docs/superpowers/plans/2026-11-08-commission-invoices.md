# Monthly Commission Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue each host one "Paid — nothing to pay" commission invoice per month from our own ledger, stored in R2 and emailed, with no accounting software.

**Architecture:** A new `@openbookings/billing` package holds all money maths, the ledger, the draft/issue/store/deliver/report steps and the PDF/CSV renderers; every step takes its I/O (db, Stripe, R2, mail, clock) as injected deps so it tests without network. A new Bun CLI `apps/invoice-job` wires real deps and runs one step per invocation (Scaleway Serverless Job). `apps/business` gets the platform webhook and the Billing page.

**Tech Stack:** Bun 1.3, TypeScript, Postgres (Neon) via `pg` + hand-written SQL migrations, Drizzle schema mirror, Stripe SDK 22.6, `pdfkit`, `@aws-sdk/client-s3` (R2), Lettermint 2.8, `@sentry/bun`, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-08-commission-invoices.md`

## Global Constraints

- Branch `feat/commission-invoices` off `feat/booking-flow` (it needs migration 0035 and the booking flow). Never commit to `main`.
- A payment is **booked** only when a booking's `stripe_payment_intent_id` equals it. Every other payment is **returned**: refunded in full with `refund_application_fee: true`, recorded with `disposition = 'returned'`, never invoiced (spec decision 8).
- A property that is not **ready** (spec decision 9) can neither be published nor sold. VAT treatment always comes from the billing profile; no country fallback.
- Commission is VAT-inclusive: the fee is `applicationFeeCents(rooms_total_cents, rate)` from `packages/stripe/src/payments/fees.ts`, unchanged. NL: `net = roundHalfUp(fee × 10000 / 12100)`, `vat = fee − net`. Reverse charge: `net = fee`, `vat = 0`.
- All money is signed integer cents. In `packages/billing` money is JS `bigint`; never a float, never `Number()` on a cent amount read from Postgres.
- `roundHalfUp` rounds half **away from zero**, so a negated amount rounds to the negated result.
- Every timestamp is `timestamptz`; month boundaries are Europe/Amsterdam.
- Migrations are hand-written, idempotent SQL in `packages/db/drizzle/`, mirrored in `packages/db/src/schema.ts`, and added to `PENDING` in `packages/db/src/testing/db-harness.ts`. Additive only (expand/contract).
- Billing tables: `ON DELETE RESTRICT` on every FK; no guest names, emails or addresses anywhere in them.
- Booking reference = `bookingId.slice(0, 8).toUpperCase()` (what hosts already see in emails).
- Invoice number format `OB-{yyyy}-{NNNN}` (4-digit zero pad, grows past 9999); series `OB-{yyyy}` from `issued_on`.
- R2 keys `invoices/{yyyy}/{number}.pdf` and `invoices/{yyyy}/{number}-specification.csv`.
- English copy, EUR, amounts shown as `€1,234.56` / `−€9.00` (U+2212 minus).
- Fonts: pdfkit with embedded Inter (OFL) TTFs committed under `packages/billing/assets/fonts/`, so `€` and `−` render.
- Dockerfiles keep `bun install --frozen-lockfile`.
- Commits: one per task, message ending with the attribution lines from the session.

## Review Focus

1. **A second payment for an intent that is already booked**: its PaymentIntent metadata points at an intent that *has* a booking, but that booking is someone else's payment. It must be `returned`, never attached to the booking (that would double the commission). → Task 5 test `a duplicate payment for a booked intent is returned, not attached`.
2. **A host that changes billing country mid-month** (or a legacy booking with no snapshotted treatment): the month has mixed treatments → that entity is blocked with reason `mixed_vat_treatment`, others proceed. → Task 9 test.
3. **Refund in a later month of a fee whose invoice is still a draft or blocked**: the refund has no issued invoice to reference; it must still be drafted, with `refers_to_invoice_numbers` empty rather than failing. → Task 9 test `refund of a not-yet-issued fee`.
4. **The issue step crashing between commit and R2 upload**: the next run must render and upload the already-issued invoice without taking a new number. → Task 12 test `issued invoice without pdf_key is rendered on the next run`.
5. **The 25-hour October day and fees at 23:30 UTC on the last day of the month**: a fee at `2026-10-31T23:30:00Z` belongs to November (00:30 Amsterdam). → Task 1 test.

---

### Task 0: Branch, package scaffold, dependencies

**Files:**
- Create: `packages/billing/package.json`, `packages/billing/tsconfig.json`, `packages/billing/src/index.ts`
- Create: `packages/billing/assets/fonts/Inter-Regular.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`, `packages/billing/assets/fonts/OFL.txt`

- [ ] **Step 1:** `git switch -c feat/commission-invoices` from `feat/booking-flow`.
- [ ] **Step 2:** Create `@openbookings/billing` (private, `"main": "./src/index.ts"`, scripts `typecheck`, `test: bun test`) modelled on `packages/stripe/package.json`. Dependencies: `@openbookings/db`, `@openbookings/stripe`, `@openbookings/mailing` (workspace), `pdfkit`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (same major as `apps/business`); dev: `@types/pdfkit`, `@types/bun`, `typescript`, `@openbookings/config`.
- [ ] **Step 3:** Download Inter static TTFs (Regular, SemiBold, Bold) from the official rsms/inter release into `assets/fonts/` with the OFL licence.
- [ ] **Step 4:** `bun install` at the root; `bun run --cwd packages/billing typecheck` passes.
- [ ] **Step 5:** Commit `Scaffold the billing package`.

### Task 1: Money, VAT split and period bounds (pure)

**Files:**
- Create: `packages/billing/src/money.ts`, `packages/billing/src/vat.ts`, `packages/billing/src/period.ts`
- Test: `packages/billing/src/money.test.ts`, `vat.test.ts`, `period.test.ts`

**Interfaces:**
- Produces:
  - `roundHalfUp(numerator: bigint, denominator: bigint): bigint` (denominator > 0, half away from zero)
  - `type VatTreatment = 'NL_DOMESTIC' | 'EU_REVERSE_CHARGE'`
  - `vatRateBp(t: VatTreatment): 2100n | 0n`
  - `vatTreatmentFor(countryCode: string): VatTreatment` — `NL` → domestic, other EU-27 → reverse charge, anything else throws `NonEuCountryError`
  - `splitInclusive(gross: bigint, rateBp: bigint): { net: bigint; vat: bigint }` — `net = roundHalfUp(gross × 10000, 10000 + rateBp)`, `vat = gross − net`
  - `splitRefund(original: { base: bigint; gross: bigint; rateBp: bigint }, refund: bigint): { base: bigint; net: bigint; vat: bigint }` — all negative; when `refund === original.gross` returns the negated original split exactly
  - `type Period = { start: string /* YYYY-MM-01 */; end: string /* last day */; from: Date; to: Date }`
  - `periodFor(yyyyMm: string): Period`, `previousPeriod(now: Date): Period`, `periodOf(instant: Date): string /* YYYY-MM in Amsterdam */`
  - `formatEuro(cents: bigint): string` → `€1,234.56` / `−€9.00`

- [ ] **Step 1: Write the failing tests**

```ts
// money.test.ts
expect(roundHalfUp(5n, 2n)).toBe(3n);      // 2.5 → 3
expect(roundHalfUp(-5n, 2n)).toBe(-3n);    // −2.5 → −3
expect(roundHalfUp(4n, 3n)).toBe(1n);
expect(roundHalfUp(0n, 7n)).toBe(0n);
expect(() => roundHalfUp(1n, 0n)).toThrow();
expect(formatEuro(-900n)).toBe('−€9.00');
expect(formatEuro(123456n)).toBe('€1,234.56');

// vat.test.ts
expect(splitInclusive(12069n, 2100n)).toEqual({ net: 9974n, vat: 2095n }); // canvas example, inclusive
expect(splitInclusive(6930n, 0n)).toEqual({ net: 6930n, vat: 0n });
expect(vatTreatmentFor('nl')).toBe('NL_DOMESTIC');
expect(vatTreatmentFor('BE')).toBe('EU_REVERSE_CHARGE');
expect(() => vatTreatmentFor('GB')).toThrow(NonEuCountryError);
// partial refund sums: for every r in 1..gross, net + vat === -r and |base| <= original.base
const orig = { base: 24000n, gross: 1080n, rateBp: 2100n };
for (let r = 1n; r <= 1080n; r++) { const s = splitRefund(orig, r); expect(s.net + s.vat).toBe(-r); }
expect(splitRefund(orig, 1080n)).toEqual({ base: -24000n, ...negate(splitInclusive(1080n, 2100n)) });

// period.test.ts
const oct = periodFor('2026-10');
expect(oct.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
expect(oct.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');   // 25-hour day handled
expect(periodFor('2026-03').to.toISOString()).toBe('2026-03-31T22:00:00.000Z');
expect(periodOf(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
expect(previousPeriod(new Date('2026-11-01T05:00:00Z')).start).toBe('2026-10-01');
expect(previousPeriod(new Date('2026-01-01T06:00:00Z')).start).toBe('2025-12-01');
expect(() => periodFor('2026-13')).toThrow();
```

- [ ] **Step 2:** `bun test packages/billing/src` → FAIL (modules missing).
- [ ] **Step 3:** Implement. Amsterdam midnight: find the UTC offset at local midnight with `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', timeZoneName: 'longOffset' })` (midnight on the 1st is never inside a DST gap). EU-27 list as a frozen set in `vat.ts`.
- [ ] **Step 4:** `bun test packages/billing/src` → PASS.
- [ ] **Step 5:** Commit `Add billing money, VAT split and period maths`.

### Task 2: Migration 0036 — billing tables, triggers, booking split columns

**Files:**
- Create: `packages/db/drizzle/0036_commission_invoices.sql`
- Modify: `packages/db/src/schema.ts` (bookings columns + new tables), `packages/db/src/testing/db-harness.ts` (`PENDING`)
- Test: `packages/db/src/commission-invoices-schema.db.test.ts`

**Interfaces:**
- Produces (SQL): tables `billing_profiles`, `commission_entries`, `invoice_sequences`, `invoice_runs`, `invoices` exactly as the spec's Schema section; `bookings` gains `commission_rate numeric(6,5) NULL`, `commission_vat_treatment text NULL CHECK IN ('NL_DOMESTIC','EU_REVERSE_CHARGE')`, `commission_net_cents bigint NULL`, `commission_vat_cents bigint NULL`. Triggers `commission_entries_append_only` and `invoices_immutable` (plpgsql, `RAISE EXCEPTION` with SQLSTATE `P0001`).
- `invoices.status` CHECK, `doc_type` CHECK, `UNIQUE (billing_entity_id, period_start)`, `UNIQUE (number)`; `commission_entries` partial unique indexes and the gross CHECK; `disposition` CHECK `IN ('booked','returned')`; CHECK `disposition = 'returned' OR (booking_id, property_id, booking_ref, stay_start, stay_end all NOT NULL)`; CHECK `disposition = 'booked' OR invoice_id IS NULL` (a returned payment is never invoiced; `property_id`, `booking_ref` and stay dates are nullable for an unexplained payment); FKs: `billing_entity_id → "organization"(id)`, `property_id → properties`, `booking_id → bookings`, `booking_intent_id → booking_intents`, `invoice_id → invoices`, `refunds_entry_id → commission_entries`, `run_id → invoice_runs`; all `ON DELETE RESTRICT`.

- [ ] **Step 1: Write the failing DB tests** (`describeWithDb`, each test in a rolled-back transaction, `applyPendingMigrations` first):
  - `commission entries reject DELETE`
  - `commission entries reject UPDATE of anything but invoice_id`
  - `invoice_id can be set once and never changed`
  - `a returned entry cannot be linked to an invoice`
  - `a booked entry needs a booking, property, reference and stay dates`
  - `gross must equal net + vat`
  - `a second fee entry for the same fee id is refused`
  - `an issued invoice rejects a change to totals, number or buyer`
  - `an issued invoice may become sent and gain pdf/csv keys once`
  - `an issued invoice cannot be deleted; a draft can`
  - `an organization with billing records cannot be deleted`
- [ ] **Step 2:** `bun test packages/db/src/commission-invoices-schema.db.test.ts` with `DATABASE_URL` set → FAIL.
- [ ] **Step 3:** Write the migration (header comment in the repo's style: purpose, "apply by hand / CI", additive, re-runnable), the Drizzle mirror, and add it to `PENDING`.
- [ ] **Step 4:** Re-run → PASS. `bun run --cwd packages/db typecheck` passes.
- [ ] **Step 5:** Commit `Add billing tables and booking commission split`.

### Task 3: Snapshot the commission split at checkout

**Files:**
- Modify: `apps/web/lib/booking/quote.ts:428` (snapshot gains split), `packages/db/src/booking-intents.ts` (snapshot type, `INSERT INTO bookings` writes 4 new columns), `packages/stripe/src/payments/checkout.ts` (PI metadata)
- Create: `packages/billing/src/commission.ts`
- Test: `packages/billing/src/commission.test.ts`, extend `packages/db/src/booking-intents-convert.db.test.ts`, `packages/stripe/src/payments/checkout.test.ts`

**Interfaces:**
- Consumes: `splitInclusive`, `vatRateBp`, `vatTreatmentFor` (Task 1).
- Produces:
  - `commissionSplit(input: { feeCents: number; treatment: VatTreatment }): { netCents: number; vatCents: number }` (number at the boundary, bigint inside)
  - `IntentSnapshot` gains `commissionRate: number; commissionVatTreatment: VatTreatment; commissionNetCents: number; commissionVatCents: number`
  - `billingTreatmentForProperty(db, propertyId): Promise<VatTreatment | null>` in `packages/db/src/billing-profiles.ts`: `vatTreatmentFor(billing_profiles.country_code)` of the property's organization; `null` when there is no complete profile. No fallback to the property's country: the quote refuses a property without one (`not_ready`), which Task 4a's gate already prevents from being sold.
  - `buildBookingCheckoutParams` adds `payment_intent_data.metadata = { bookingIntentId }` (always, fee or not) taken from `input.metadata.bookingIntentId`.

- [ ] **Step 1: Failing tests**: `commissionSplit({ feeCents: 1080, treatment: 'NL_DOMESTIC' })` → `{ netCents: 893, vatCents: 187 }`; reverse charge → `{ netCents: 1080, vatCents: 0 }`. Convert test: `the booking keeps the commission split the intent recorded` (columns equal snapshot). Checkout test: `the PaymentIntent carries the booking intent id`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. An intent created before this deploy has no split in its snapshot → write NULLs (the ledger handles legacy, Task 5).
- [ ] **Step 4:** `bun test` in `packages/billing`, `packages/stripe`, `packages/db` (with DB), `apps/web` → PASS.
- [ ] **Step 5:** Commit `Record the commission VAT split on each booking`.

### Task 4: Billing profiles and VIES

**Files:**
- Create: `packages/db/src/billing-profiles.ts` (extends the file from Task 3), `packages/billing/src/vies.ts`
- Test: `packages/billing/src/vies.test.ts`, `packages/db/src/billing-profiles.db.test.ts`

**Interfaces:**
- Produces:
  - `type BillingProfile = { organizationId; legalName; addressLine1; addressLine2: string | null; postalCode; city; countryCode; vatId; kvkNumber: string | null; vatIdCheckedAt: Date | null; vatIdValid: boolean | null; viesRequestId: string | null; billingEmail; updatedAt }`
  - `getBillingProfile(db, organizationId): Promise<BillingProfile | null>`, `upsertBillingProfile(db, organizationId, fields)` (clears the VIES result when `vatId` or `countryCode` changes), `recordViesResult(db, organizationId, r: ViesResult)`
  - `missingProfileFields(p: BillingProfile | null): string[]` (required: legalName, addressLine1, postalCode, city, countryCode, vatId, billingEmail)
  - `type ViesResult = { valid: boolean; requestId: string | null; checkedAt: Date }`
  - `checkVatId(vatId: string, deps?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; requester: { countryCode: 'NL'; vatNumber: string } }): Promise<ViesResult>` — POST `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` with requester details so VIES returns a `requestIdentifier`; retries 3× (1s, 4s, 16s) on network errors, 5xx and `MS_UNAVAILABLE`/`SERVICE_UNAVAILABLE`/`MS_MAX_CONCURRENT_REQ`; then throws `ViesUnavailableError`.

  - Script `packages/billing/scripts/backfill-billing-profiles.ts` (dry run by default, `--write` to save): for every organization with a property, pre-fill from `org_profile` (legal name, KvK, VAT) and the connected Stripe account (`company.address`, `business_profile.support_email` / `email`, `country`), VIES-check reverse-charge VAT IDs, and print a table of what is still missing per organization. Never overwrites a field a profile already has.

- [ ] **Step 1: Failing tests** (fake `fetch`): valid response → `{ valid: true, requestId: 'WAPIAAAA…' }`; `MS_UNAVAILABLE` twice then valid → valid after 3 calls; always 503 → `ViesUnavailableError` after 4 calls; VAT id `BE 0123.456.789` is normalised to country `BE`, number `0123456789`. DB: `changing the VAT id clears the VIES result`; backfill: `pre-fills empty fields only` (pure merge function `mergeProfileSources(existing, orgProfile, stripeAccount)`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add billing profiles, VIES checks and a profile backfill`.

### Task 4a: Readiness gate (publish and checkout)

**Files:**
- Create: `packages/db/src/property-readiness.ts`
- Modify: `apps/business/app/(dashboard)/dashboard/listings/property/_lib/actions.ts:333` (`setPublished`), `apps/web/app/api/checkout/route.ts:88` (`assertChargeable`), `apps/web/lib/booking/quote.ts` (refuse when not ready), the listing editor's completion rail (show the readiness items next to the section items)
- Test: `packages/db/src/property-readiness.db.test.ts`, extend the checkout route test and the `setPublished` test

**Interfaces:**
- Consumes: `getBillingProfile`, `missingProfileFields` (Task 4).
- Produces:
  - `type ReadinessItem = 'stripe_account' | 'stripe_charges' | 'rates_confirmed' | 'legal_details' | 'billing_profile' | 'vat_id_verified'`
  - `propertyReadiness(db, propertyId, opts?: { chargesEnabled?: (accountId: string) => Promise<boolean> }): Promise<{ ready: boolean; missing: ReadinessItem[] }>` — `stripe_charges` only checked when `chargesEnabled` is passed (publish passes `retrieveConnectAccount(...).charges_enabled`; checkout skips the network call, Stripe refuses an account that cannot charge anyway); `legal_details` = `property_content.legal_company_name` and `vat_number` non-blank; `vat_id_verified` only for reverse-charge profiles (`vat_id_valid = true`).
  - `readinessEnforced(env = process.env): boolean` — true unless `PROPERTY_READINESS_ENFORCE === 'off'`.
  - `setPublished(…, true)` returns `{ ok: false, error: 'Before going live: <items in plain words>' }` when not ready. Checkout: `CheckoutError('config_error', …, 'warning')` with guest copy "This property can't take bookings right now."
  - Item copy (shared by the rail, the Billing checklist and the publish error): stripe_account "Connect Stripe", stripe_charges "Finish Stripe verification", rates_confirmed "Confirm your rates include VAT", legal_details "Add your legal company name and VAT number", billing_profile "Complete your billing details", vat_id_verified "Get your VAT number verified".

- [ ] **Step 1: Failing tests:** `a property with everything in place is ready`; one test per item showing it alone makes the property not ready; `an NL host needs no VIES result`; `publishing a property that is not ready is refused with the missing items`; `checkout refuses a property that is not ready`; `with PROPERTY_READINESS_ENFORCE=off checkout and publish are not gated`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Require Stripe, legal and billing details before a property can go live or be booked`.

### Task 5: Ledger ingestion

**Files:**
- Create: `packages/billing/src/ledger/ingest.ts`, `packages/billing/src/ledger/resolve.ts`
- Modify: `packages/stripe/src/payments/refund.ts` (`returnUnexplainedPayment`), `packages/stripe/src/index.ts`
- Test: `packages/billing/src/ledger/ingest.db.test.ts`, `packages/stripe/src/payments/refund.test.ts`

**Interfaces:**
- Consumes: `splitInclusive`, `splitRefund`, `vatTreatmentFor` (Task 1); `getBillingProfile` (Task 4); booking split columns (Task 2/3).
- Produces:
  - `type FeeLike = { id: string; amount: number; currency: string; created: number; account: string; charge: string }` (Stripe `ApplicationFee` fields used)
  - `type FeeRefundLike = { id: string; amount: number; created: number; fee: string }`
  - `type ChargeInfo = { paymentIntentId: string; metadata: Record<string, string>; amount: number; amountRefunded: number }`
  - `type LedgerDeps = { db: Queryable; chargeInfo(chargeId: string, accountId: string): Promise<ChargeInfo>; returnPayment(chargeId: string, accountId: string, reason: 'unexplained'): Promise<{ refundId: string }>; audit(entry: { action: 'payment.unexplained-returned'; stripeAccountId: string; dedupeKey: string; detail: object }): Promise<void>; report(error: unknown, context?: object): void }`
  - `returnPayment` (real one, new in `packages/stripe/src/payments/refund.ts`): full refund on the host's account with `refund_application_fee: true`, idempotency key `return-unexplained:{chargeId}`.
  - `recordApplicationFee(fee: FeeLike, deps: LedgerDeps): Promise<{ entryId: string; inserted: boolean; disposition: 'booked' | 'returned' }>`
  - `recordApplicationFeeRefund(refund: FeeRefundLike, deps: LedgerDeps, fetchFee: (feeId: string) => Promise<FeeLike>): Promise<{ entryId: string; inserted: boolean }>` — records the original fee first if it is missing; a refund inherits its fee's disposition
  - `class UnknownAccountError` (`fee.account` is not any organization's `org_profile.stripe_account_id`: thrown, reported, nothing inserted)
- Resolution: billing entity = organization whose `org_profile.stripe_account_id = fee.account`. **Booked** iff a booking has `stripe_payment_intent_id = charge.paymentIntentId`: treatment and split from the booking's columns (when NULL, legacy: treatment from the billing profile, `splitInclusive(fee.amount)`), base = `rooms_total_cents`, stay dates and reference from the booking. If `fee.amount ≠ booking.commission_cents`: re-split the Stripe amount, `amount_mismatch = true`, `deps.report(...)`. **Returned** otherwise: base 0, split by the billing profile's treatment, property and stay dates from the intent named in `metadata.bookingIntentId` when there is one (NULL otherwise). If `charge.amountRefunded < charge.amount`: when the intent is `oversold`/`refunded_oversold` or already has a different booking, the existing confirmation flow refunds it, so only report; when there is no intent at all (unexplained), call `returnPayment`, `audit`, and `report` at level warning.
- Insert with `ON CONFLICT DO NOTHING`; on conflict return the existing row's id with `inserted: false`.

- [ ] **Step 1: Failing DB tests** (seeded property + org + booking via helpers in `db-harness.ts`; fake `chargeInfo` / `returnPayment` / `audit`):
  - `records an NL fee with the booking's split` (gross 1080, net 893, vat 187, base = rooms_total_cents, booking_ref = first 8 of id, upper, disposition booked)
  - `records a BE fee as reverse charge`
  - `a second delivery of the same fee inserts nothing`
  - `a legacy booking without a split is split from the billing profile`
  - `a fee that differs from the booking's commission is kept, flagged and reported`
  - `a fee on an oversold intent is returned, not booked` (booking_id NULL, property from the intent, no `returnPayment` call)
  - `a duplicate payment for a booked intent is returned, not attached`
  - `an unexplained payment is returned in full, audited and reported` (`returnPayment` called once; a second delivery does not call it again)
  - `an already refunded unexplained payment is not refunded again`
  - `a full fee refund negates the original`
  - `a partial fee refund splits proportionally and points at the original`
  - `a refund of a returned fee is returned too`
  - `a refund whose fee is not in the ledger records the fee first`
  - `a fee on an account no organization owns throws UnknownAccountError and inserts nothing`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Record application fees and fee refunds in the commission ledger`.

### Task 6: Platform webhook

**Files:**
- Modify: `packages/stripe/src/events.ts` (two cases + deps), `packages/stripe/src/index.ts`
- Create: `apps/business/app/api/stripe/platform-webhook/route.ts`, `apps/business/lib/billing/ledger-deps.ts`
- Modify: `apps/business/package.json` (add `@openbookings/billing`)
- Test: `packages/stripe/src/events.test.ts`

**Interfaces:**
- Produces: `StripeEventDeps` gains `onApplicationFee?(fee: FeeLike & { eventId: string }): Promise<void>` and `onApplicationFeeRefunded?(input: { eventId: string; fee: FeeLike; refunds: FeeRefundLike[] }): Promise<void>` (Stripe's `application_fee.refunded` carries the fee with `refunds.data`; record every refund on it). Route cases for `application_fee.created` and `application_fee.refunded`; these events have no `event.account`.
- The route: same shape as `apps/business/app/api/stripe/webhook/route.ts`, `secret: process.env.STRIPE_PLATFORM_WEBHOOK_SECRET`, `name: "platform"`, deps wired to `recordApplicationFee` / `recordApplicationFeeRefund` through `apps/business/lib/billing/ledger-deps.ts`: `chargeInfo` = `stripe.charges.retrieve(chargeId, { expand: ['payment_intent'] }, { stripeAccount })` (metadata from the PaymentIntent), `returnPayment` = `returnUnexplainedPayment`, `audit` = the same `audit_log` insert the Connect webhook uses. The job (Task 15) reuses this module's builder, so it lives in `packages/billing/src/ledger/stripe-deps.ts` and the app file only adds Sentry. Doc comment says: "Events on your account" endpoint, subscribed to exactly these two events; local: `stripe listen --forward-to localhost:3001/api/stripe/platform-webhook`.

- [ ] **Step 1: Failing tests:** `application_fee.created calls onApplicationFee with the fee`; `application_fee.refunded passes every refund on the fee`; `a connected-account event of these types is ignored` (has `account`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `bun test packages/stripe` and `bun run --cwd apps/business typecheck` → PASS.
- [ ] **Step 5:** Commit `Receive application fee events on a platform webhook`.

### Task 7: Reconcile the ledger against Stripe

**Files:**
- Create: `packages/billing/src/steps/reconcile.ts`
- Test: `packages/billing/src/steps/reconcile.db.test.ts`

**Interfaces:**
- Consumes: Task 5 functions; `Period`.
- Produces:
  - `type StripeLedgerSource = { listBalanceTransactions(p: Period): AsyncIterable<{ type: 'application_fee' | 'application_fee_refund'; source: string; amount: number; created: number }>; retrieveFee(id: string): Promise<FeeLike>; retrieveFeeRefund(id: string): Promise<FeeRefundLike> }`
  - `type ReconcileResult = { status: 'succeeded' | 'blocked'; backfilled: string[]; missingInStripe: string[]; amountMismatches: { id: string; stripe: number; ledger: string }[]; unknownAccounts: string[]; returned: { feeId: string; chargeRef: string; gross: string; refundedGross: string }[]; notYetReturned: string[]; totals: { booked: { fees: number; refunds: number; gross: string }; returned: { fees: number; refunds: number; gross: string } } }`
  - A returned fee of the period whose fee refunds in the ledger (in **any** month, so a refund that lands just after midnight on the 1st still counts) do not add up to its gross: call `ledger.returnPayment` (unless dry run), record the resulting fee refund, check again; still short → listed in `notYetReturned` and the run is `blocked`.
  - `reconcile(period: Period, deps: { db; stripe: StripeLedgerSource; ledger: LedgerDeps; dryRun: boolean }): Promise<ReconcileResult>`
- Real `listBalanceTransactions` (in Task 13): `stripe.balanceTransactions.list({ type, created: { gte, lt }, limit: 100 })` auto-paginated, once per type. Balance transaction `amount` for a fee refund is negative; compare `|amount|` with the ledger's `|gross_amount|`. `dryRun` reports what it would backfill without inserting.

- [ ] **Step 1: Failing tests:** `everything matches → succeeded`; `a fee missing in the ledger is backfilled, then succeeded`; `a ledger entry Stripe does not have → blocked`; `an amount mismatch → blocked`; `a fee on an unknown account → blocked, listed`; `a returned fee that was never refunded is returned now`; `a returned fee that cannot be refunded blocks the run`; `dry run backfills and returns nothing`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Reconcile the commission ledger against Stripe`.

### Task 8: Run bookkeeping and the run report

**Files:**
- Create: `packages/billing/src/runs.ts`, `packages/billing/src/notify.ts`
- Test: `packages/billing/src/runs.db.test.ts`, `packages/billing/src/notify.test.ts`

**Interfaces:**
- Produces:
  - `type Step = 'backfill' | 'draft' | 'issue' | 'store' | 'deliver' | 'report'`
  - `withRun<T>(db, input: { periodStart: string; step: Step }, work: (runId: string) => Promise<{ status: 'succeeded' | 'blocked'; report: object; value: T }>): Promise<{ runId: string; status; report; value: T }>` — inserts `running`, sets `succeeded`/`blocked`/`failed` + `finished_at`; on throw writes `failed` with `{ error: message }` and rethrows
  - `lastReconcileStatus(db, periodStart): Promise<'succeeded' | 'blocked' | 'failed' | null>` (latest `draft` run's `report.reconcile.status`)
  - `sendRunReport(report: DraftReport, deps: { mail: (m: { to: string; subject: string; text: string }) => Promise<void>; slack?: (text: string) => Promise<void>; to: string })` — plain-text summary: counts, totals per VAT treatment, blockers per entity, rounding diffs.

- [ ] **Step 1: Failing tests:** `a thrown step is recorded as failed and rethrown`; `a blocked step is recorded as blocked`; notify: `the summary lists each blocked entity with its reasons` and `slack is skipped when not configured`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Record invoice runs and send the run report`.

### Task 9: Draft step

**Files:**
- Create: `packages/billing/src/steps/draft.ts`, `packages/billing/src/steps/eligibility.ts`
- Test: `packages/billing/src/steps/draft.db.test.ts`, `packages/billing/src/steps/eligibility.test.ts`

**Interfaces:**
- Consumes: `reconcile` (7), `withRun` (8), `getBillingProfile`/`missingProfileFields`/`recordViesResult`/`checkVatId` (4), `splitInclusive` (1).
- Produces:
  - `type Blocker = { entityId: string; reasons: ('missing_fields' | 'mixed_vat_treatment' | 'vies_invalid' | 'vies_unavailable' | 'non_eu')[]; missing?: string[] }`
  - `checkEligibility(entityIds: string[], period: Period, deps: { db; vies: typeof checkVatId; now: () => Date }): Promise<{ eligible: string[]; blocked: Blocker[] }>` — VIES re-check only for reverse-charge entities whose check is missing or older than 30 days
  - `type DraftTotals = { feeCount; feeBaseTotal; feeGrossTotal; refundCount; refundBaseTotal; refundGrossTotal; grossTotal; netTotal; vatTotal; vatCollected; vatRoundingDiff: bigint; docType: 'invoice' | 'credit_note'; vatTreatment; vatRateBp }`
  - `draftTotals(rows: { kind; base: bigint; gross: bigint; vat: bigint }[], treatment: VatTreatment): DraftTotals` (pure; inclusive formulas from the spec)
  - `runDraft(period: Period, deps: { db; stripe: StripeLedgerSource; ledger: LedgerDeps; vies; now; entity?: string; dryRun: boolean }): Promise<DraftReport>` — reconcile (blocked → stop, no drafts); candidates = entities with at least one un-invoiced **booked** entry in the period (returned entries are ignored entirely, so a month of only returned payments yields no document); eligibility; per eligible entity: aggregate its un-invoiced booked entries in the period, referenced invoice numbers (spec query), upsert the `draft` row (`ON CONFLICT (billing_entity_id, period_start) DO UPDATE ... WHERE invoices.status = 'draft'`); delete drafts for entities that now have no entries. `dryRun` writes nothing but the run row.
- `DraftReport = { period: string; reconcile: ReconcileResult; drafts: { entityId; invoiceId; totals: DraftTotals }[]; blocked: Blocker[]; skippedIssued: string[] }`

- [ ] **Step 1: Failing tests:**
  - pure `draftTotals`: NL month gross 12069 → net 9974, vat 2095; credit note when gross < 0; `zero total stays an invoice` (fee + full refund same month → gross 0, docType invoice); vat_rounding_diff = vatTotal − Σvat.
  - DB: `a confirmed booking fully refunded in the same month gets a €0.00 invoice`; `a month with only returned payments gets no document`; `returned entries never count towards a draft's totals`.
  - eligibility: `missing billing email blocks with missing_fields`; `mixed treatments in the month block the entity`; `invalid VIES blocks`; `VIES down blocks with vies_unavailable`; `a VIES check younger than 30 days is not repeated`.
  - DB: `one draft per eligible host`; `a rerun replaces the draft`; `an issued invoice is left untouched by a rerun`; `a blocked reconcile creates no drafts`; `refund of a not-yet-issued fee` (refers_to empty, still drafted); `referenced invoice numbers come from the refunded fees' invoices`; `--entity limits the run to one host`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Draft monthly commission invoices`.

### Task 10: PDF and CSV rendering

**Files:**
- Create: `packages/billing/src/render/document.ts` (view model), `packages/billing/src/render/pdf.ts`, `packages/billing/src/render/csv.ts`
- Test: `packages/billing/src/render/csv.test.ts`, `packages/billing/src/render/pdf.test.ts`, `packages/billing/src/render/document.test.ts`

**Interfaces:**
- Produces:
  - `type InvoiceDocument = { docType; number: string | null /* null = draft */; issuedOn: string | null; period: { start; end }; seller: PartySnapshot; buyer: PartySnapshot; vatTreatment; lines: { fee: { count; base; gross }; refund: { count; base; gross; refersTo: string[] } | null }; totals: { net; vat; gross }; rows: SpecRow[] }`
  - `type PartySnapshot = { legalName; addressLines: string[]; countryName; vatId; kvk: string | null; email: string | null }`
  - `type SpecRow = { kind: 'fee' | 'fee_refund'; bookingRef; paidOn: string /* Amsterdam date */; stayStart; stayEnd; base: bigint; gross: bigint; stripePaymentRef; refundNote?: string /* 'Cancelled · 50% refund · from OB-2026-0031' */ }`
  - `loadInvoiceDocument(db, invoiceId): Promise<InvoiceDocument>` — reads **only** the invoice row's snapshots/totals and its linked entries (drafts: the period's un-invoiced entries)
  - `renderPdf(doc: InvoiceDocument, opts?: { watermark?: 'DRAFT' }): Promise<Uint8Array>`
  - `renderCsv(doc: InvoiceDocument): string`
- PDF layout = the canvas (A4, 64pt margins, Inter, accent `#1f5c4a`, greys `#555555`/`#d9d9d9`), with the inclusive adaptations from spec decision 1. Page 1 title "Invoice" or "Credit note"; NL totals "Subtotal / VAT 21% / Total", RC "Subtotal / VAT reverse charged €0.00 / Total" plus the Article 196 line; the green "PAID" notice; footer: "Commission for intermediation in accommodation bookings, acting as disclosed agent in the name and on behalf of the host, under the Host Agreement. Accommodation value is the price of the stay including VAT, excluding tourist tax." Page 2+: "Specification per booking", table columns from the spec, refund rows shaded `#f7f7f7`, totals block with rows "Bookings (n)", "Refunds (n)", "Total commission"; "Page x of y" in every footer; the table repeats its header on overflow.
- CSV header: `booking;kind;paid_on;stay_start;stay_end;accommodation_value;commission;stripe_payment;refers_to_invoice` — UTF-8, no BOM, `\n` line ends, amounts `-4.05`/`10.80`.

- [ ] **Step 1: Failing tests:** CSV exact output for a two-row doc (one fee, one partial refund); `csv has no guest data` (the view model type has no name field; assert header); document: `a credit note's title is Credit note`, `spec totals equal the invoice totals`; PDF: `renders an NL invoice with 40 rows to 3 pages` (count `/Type /Page` objects), `draft watermark`, and text extraction of page 1 contains `OB-2026-0042`, `VAT 21%`, `€120.69` (use pdfkit with `compress: false` in tests).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Render the canvas's NL and BE examples to `packages/billing/scripts/out/` via `packages/billing/scripts/render-samples.ts` and compare by eye against the canvas. Commit `Render commission invoices as PDF and CSV`.

### Task 11: Issue step (numbering)

**Files:**
- Create: `packages/billing/src/steps/issue.ts`, `packages/billing/src/seller.ts`
- Test: `packages/billing/src/steps/issue.db.test.ts`, `packages/billing/src/seller.test.ts`

**Interfaces:**
- Produces:
  - `sellerFromEnv(env: Record<string, string | undefined>, mode: 'live' | 'test'): PartySnapshot` — throws `SellerConfigError` listing missing `SELLER_LEGAL_NAME`, `SELLER_ADDRESS` (lines split on `\n`), `SELLER_KVK`, `SELLER_VAT_ID`, `SELLER_BILLING_EMAIL` in live; placeholders `[SELLER_…]` in test
  - `issueInvoice(db, invoiceId: string, input: { today: string /* YYYY-MM-DD Amsterdam */; seller: PartySnapshot; buyer: PartySnapshot }): Promise<{ number: string } | { skipped: 'not_draft' }>` — one transaction exactly as the spec (insert series, `SELECT … FOR UPDATE`, increment, update invoice `WHERE status = 'draft'`, link entries `WHERE invoice_id IS NULL AND billing_entity_id AND occurred_at in period`, assert affected = fee_count + refund_count else throw `IssueMismatchError` → rollback)
  - `runIssue(period: Period, deps: { db; env; mode; today; entity?: string }): Promise<IssueReport>` — refuses unless `lastReconcileStatus === 'succeeded'`; issues every draft of the period in `billing_entity_id` order; buyer snapshot from the billing profile at issue time.

- [ ] **Step 1: Failing tests:** seller: `live mode lists every missing seller variable`. DB: `the first invoice of 2026 is OB-2026-0001`; `numbers continue per year and restart in a new year`; `20 parallel issues give 20 distinct gapless numbers` (20 drafts for 20 orgs, `Promise.all` over separate pool clients, assert the sorted set is 0001–0020); `a mismatch in linked entries rolls back and leaves no gap`; `issuing twice changes nothing`; `refuses when reconcile did not succeed`.
- [ ] **Step 2–4:** FAIL → implement → PASS (the concurrency test needs real connections: use a `pg.Pool` against the test branch, clean up by org id prefix instead of transaction rollback).
- [ ] **Step 5:** Commit `Issue commission invoices with gapless numbers`.

### Task 12: Store in R2

**Files:**
- Create: `packages/billing/src/storage/r2.ts`, `packages/billing/src/steps/store.ts`
- Test: `packages/billing/src/steps/store.db.test.ts`

**Interfaces:**
- Produces:
  - `type ObjectStore = { head(key): Promise<{ sha256: string | null } | null>; put(key, body: Uint8Array, contentType, sha256: string): Promise<void>; presign(key, ttlSeconds: number, filename: string): Promise<string> }`
  - `createR2Store(env): ObjectStore` — `S3Client` with `region: 'auto'`, `endpoint: INVOICES_R2_ENDPOINT`, keys `INVOICES_R2_ACCESS_KEY_ID`/`INVOICES_R2_SECRET_ACCESS_KEY`, bucket `INVOICES_R2_BUCKET`; stores the sha256 as object metadata `sha256` and sends `ChecksumSHA256`
  - `storeInvoice(db, invoiceId, deps: { store: ObjectStore; render: { pdf; csv } }): Promise<'stored' | 'already_stored'>` — only for `status <> 'draft'` and `pdf_key IS NULL` (or `csv_key IS NULL`); HEAD → same hash: record keys; different hash: throw `StoredObjectConflictError` (alert, stop); absent: put, then record
  - `runStore(period, deps)`: every issued invoice of the period missing keys.

- [ ] **Step 1: Failing tests** (in-memory `ObjectStore`): `uploads pdf and csv and records keys and hashes`; `issued invoice without pdf_key is rendered on the next run`; `an object already there with the same hash is just recorded`; `an object there with a different hash stops with an alert`; `a stored invoice is never rendered again`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Store issued invoices in R2`.

### Task 13: Deliver step

**Files:**
- Create: `packages/billing/src/steps/deliver.ts`, `packages/mailing/src/templates/commission-invoice.ts` (or the repo's template convention in `packages/mailing/src/template.ts`)
- Test: `packages/billing/src/steps/deliver.db.test.ts`

**Interfaces:**
- Produces:
  - `type InvoiceMailer = (m: { to: string; subject: string; html: string; text: string; attachments: { filename: string; base64: string; contentType: string }[]; idempotencyKey: string }) => Promise<{ messageId: string }>` — real one: Lettermint `.from(fromAddress()).to().subject().html().text().attach(filename, base64, undefined, type).idempotencyKey(key).send()`
  - `runDeliver(period, deps: { db; store: ObjectStore; mail: InvoiceMailer; fetchObject(key): Promise<Uint8Array> })` — for each `issued` invoice with `sent_at IS NULL` and both keys set: attach `OB-2026-0042.pdf` and `OB-2026-0042-specification.csv` (read back from R2, not re-rendered), idempotency key = invoice id, then `status = 'sent'`, `sent_at`, `email_message_id`.
- Subject: `Your OpenBookings commission invoice OB-2026-0042 (October 2026)` / `Credit note …`. Body: invoice for commission already collected via Stripe, nothing to pay, link to Finance → Billing.

- [ ] **Step 1: Failing tests:** `sends each issued invoice once with both attachments`; `a second run sends nothing`; `an invoice not yet stored is not sent`; `a failed send leaves the invoice issued for the next run`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Email issued invoices to hosts`.

### Task 14: Reporting views and report step

**Files:**
- Create: `packages/db/drizzle/0037_billing_report_views.sql`, `packages/billing/src/steps/report.ts`
- Modify: `packages/db/src/testing/db-harness.ts` (`PENDING`)
- Test: `packages/billing/src/steps/report.db.test.ts`

**Interfaces:**
- Produces: views `v_vat_return_quarter (quarter text 'YYYYQn', nl_net, nl_vat, rc_net)`, `v_icp_listing_quarter (quarter, vat_id, country_code, rc_net)`, `v_dac7_fees_quarter (quarter, billing_entity_id, legal_name, fee_gross)` — quarter from `issued_on`; only `status IN ('issued','sent')`; credit notes count negative (their totals are already negative). `buyer->>'vatId'` for the ICP listing.
- Also `v_returned_payments_quarter (quarter, billing_entity_id, stripe_account_id, stripe_payment_ref, stripe_application_fee_id, fee_gross, refunded_gross, returned_on)` — quarter from the fee's `occurred_at` (Amsterdam), one row per returned fee.
- `runReport(quarter: string, deps: { db; outDir: string }): Promise<string[]>` writes four `;`-separated CSVs named `{quarter}-vat-return.csv`, `{quarter}-icp.csv`, `{quarter}-dac7.csv`, `{quarter}-returned-payments.csv`, plus `{quarter}-stripe-reconciliation.csv`: one line per month M: Stripe fees − fee refunds created in M = gross total of the invoices for period M + returned net in M (non-zero only when a return crosses a month end; the next month's line evens it out), plus a line for booked entries not yet invoiced (blocked hosts). Every euro in Stripe is on an invoice, on the returned list, or named as pending.

- [ ] **Step 1: Failing tests:** for a seeded quarter with one NL invoice, one BE invoice, one BE credit note and one returned payment: `the VAT return splits domestic and reverse-charge turnover`; `the ICP listing nets the BE credit note`; `drafts are left out`; `returned payments are listed and net to zero`; `the reconciliation sheet ties Stripe totals to invoiced plus returned`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `Add quarterly VAT, ICP and DAC7 reports`.

### Task 15: The job app (`apps/invoice-job`)

**Files:**
- Create: `apps/invoice-job/package.json`, `tsconfig.json`, `src/main.ts`, `src/args.ts`, `src/deps.ts`, `src/guards.ts`, `Dockerfile`, `README.md`
- Modify: `.github/workflows/ci.yml` (build + push `openbookings-invoice-job` image like support-bot; no container roll)
- Test: `apps/invoice-job/src/args.test.ts`, `apps/invoice-job/src/guards.test.ts`

**Interfaces:**
- Produces:
  - `parseArgs(argv: string[], now: Date): { step: Step; period: Period; from?: Period; quarter?: string; dryRun: boolean; entity?: string; preview: boolean }` (default period = `previousPeriod(now)`; `--step=report` requires `--quarter`; `--step=backfill` requires `--from` and runs `reconcile` for each month from `--from` through the previous month, writing one `invoice_runs` row per month with step `backfill`; issuing still needs a succeeded `draft` run, so a backfill never stands in for one)
  - `assertModeMatch(env): 'live' | 'test'` — live = `STRIPE_SECRET_KEY` starts `sk_live_`; database is production when `INVOICE_DB_ENV === 'production'`; mismatch throws `ModeMismatchError`
  - `main()` — Sentry (`@sentry/bun`, `SENTRY_DSN`) init; for `draft`, wrap in `Sentry.withMonitor('invoice-draft', …, { schedule: { type: 'crontab', value: '0 6 1 * *' }, timezone: 'Europe/Amsterdam' })`; after a non-dry `draft` run, `sendRunReport` (Task 8) to `INVOICE_REPORT_EMAIL` and Slack; `--step=issue` runs issue then store (store retryable on its own via `--step=store`); `--preview` with `--entity` renders the draft to `./out/DRAFT-{entity}-{period}.pdf`; exit code 0 succeeded, 2 blocked, 1 failed.
- Dockerfile: copy of `apps/support-bot/Dockerfile` with the app name changed, `CMD ["bun", "run", "apps/invoice-job/src/main.ts"]`, no `EXPOSE`; the fonts under `packages/billing/assets` come along via the pruned source.
- README: every env var (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `INVOICE_DB_ENV`, `INVOICES_R2_*`, `LETTERMINT_PROJECT_TOKEN`, `INVOICE_REPORT_EMAIL`, `SLACK_WEBHOOK_URL`, `SELLER_*`, `VIES_REQUESTER_VAT`, `SENTRY_DSN`), the monthly runbook (review draft email → `--step=issue` → check PDFs → `--step=deliver`, by the 15th), the Scaleway Serverless Job setup (`nl-ams`, cron `0 6 1 * *` Europe/Amsterdam with `--step=draft`), and the rollout order from the spec.

- [ ] **Step 1: Failing tests:** args: `defaults to the previous Amsterdam month`, `report needs a quarter`, `backfill needs --from and covers every month up to last month`, `rejects an unknown step`; guards: `live key against a non-production database is refused` and the reverse.
- [ ] **Step 2–4:** FAIL → implement → PASS. `docker build -f apps/invoice-job/Dockerfile .` succeeds.
- [ ] **Step 5:** `bun run apps/invoice-job/src/main.ts --step=draft --period=2026-10 --dry-run` against the dev database prints a report. Commit `Add the monthly invoice job`.

### Task 16: Billing in `apps/business`

**Files:**
- Create: `apps/business/app/(dashboard)/dashboard/finance/billing/page.tsx`, `.../billing/_components/invoice-list.tsx`, `.../billing/_components/upcoming-invoice.tsx`, `.../billing/_components/billing-details-form.tsx`, `.../billing/_components/readiness-checklist.tsx`, `.../billing/actions.ts`, `apps/business/app/api/billing/invoices/[id]/download/route.ts`, `apps/business/lib/billing/queries.ts`
- Modify: `packages/authz/src/permissions.ts` (resource `billing: ["read", "update"]`; owner, admin and finance get both), `packages/authz/src/role-guide.ts` (describe it), the Finance page / sidebar nav to link "Billing"
- Test: `packages/authz/src/permissions.test.ts`, `apps/business/lib/billing/queries.db.test.ts`, `apps/business/app/api/billing/invoices/[id]/download/route.test.ts`

**Interfaces:**
- Consumes: `getOrgScopedDb` + `roleAllows(memberRole, { billing: ['read'] })` (page, downloads), `{ billing: ['update'] }` (billing details form); `upsertBillingProfile`, `checkVatId` (4); `propertyReadiness` (4a); `draftTotals` (9); `createR2Store().presign` (12).
- Produces:
  - `listInvoices(scoped): Promise<InvoiceListRow[]>` (issued/sent only — drafts are never shown to hosts)
  - `upcomingInvoice(scoped, now): Promise<{ period: Period; rows: SpecRow[]; totals: DraftTotals | null; treatment: { kind: VatTreatment; label: string } | null; blockers: string[] }>` — the current Amsterdam month's un-invoiced **booked** entries, totals via the same `draftTotals` the job uses, `label` = "21% Dutch VAT is included in the commission" or "Reverse charge: VAT number {vatId} verified on {date}", `blockers` in plain words (details incomplete, VAT number not verified). Returned payments are not shown.
  - Server action `recheckVatId()` (`billing:update`): runs `checkVatId` and stores the result, for the "Check again" button.
  - `GET /api/billing/invoices/:id/download?file=pdf|csv` → 302 to a 300-second presigned URL; 404 when the invoice is not the session org's (checked in the route on every request).
  - Server action `saveBillingDetails(formData)` (`billing:update`) validated with zod (country must be EU-27; VAT id required); runs `checkVatId` after saving for non-NL countries (VIES down → saved, shown as "not verified yet").
- UI: per the design workflow, start from Mobbin references for billing/invoice-list screens, make a concept on the existing Finance page, get Wouter's review, then build with the existing dashboard components (`SiteHeader`, `Card`, `Badge`, table styles). The readiness checklist uses the item copy from Task 4a and shows on Billing and on the listing editor's rail.

- [ ] **Step 1: Failing tests:** permissions: `finance can read and update billing but not update the org`, `manager has no billing access`; queries/routes: `a member of another organization gets 404 for an invoice`; `a role without billing:read gets 404`; `drafts are not listed`; `the upcoming invoice shows only this month's un-invoiced booked entries`; `the upcoming invoice uses the same totals as the draft step`; `an unverified reverse-charge VAT number is listed as a blocker`.
- [ ] **Step 2–4:** FAIL → implement → PASS. `bun run --cwd apps/business typecheck` and lint pass.
- [ ] **Step 5:** Check it in the running app (the `run` skill): list, download, details form. Commit `Show commission invoices and billing details to hosts`.

### Task 17: Stripe test-mode integration test, docs and data map

**Files:**
- Create: `packages/billing/src/integration.stripe.test.ts`
- Modify: `docs/privacy/data-map.md` (billing tables: retain-restricted, 7 years fiscal, excluded from deletion), `apps/business/app/api/cron/pii-retention/route.ts` (confirm it does not touch billing tables; add a comment), `apps/docs/content/docs/business/getting-paid/your-statement.mdx` (replace the placeholder: monthly invoice, what's on it, where to download), `apps/docs/content/docs/business/getting-paid/how-commission-works.mdx` (one paragraph: monthly VAT invoice, "nothing to pay"; replace "You do not receive a separate bill to settle." with "You receive a monthly invoice for your records; there is nothing to pay.")

- [ ] **Step 1: Write the integration test**, `describe.skipIf(!process.env.STRIPE_TEST_SECRET_KEY || !process.env.DATABASE_URL)`: create two test connected accounts (NL, BE), direct-charge PaymentIntents with `application_fee_amount` using `pm_card_visa`, one full and one 50% refund with `refund_application_fee: true`; run ingestion via reconcile, draft, issue, store (in-memory store unless `INVOICES_R2_BUCKET` points at the **test** bucket), deliver (fake mailer); assert ledger = Stripe, two documents with the expected totals, one send each; clean up the accounts.
- [ ] **Step 2:** Run with test keys → PASS.
- [ ] **Step 3:** Docs and data map edits.
- [ ] **Step 4:** Full check: `bun run typecheck && bun run test` at the root → PASS.
- [ ] **Step 5:** Commit `Document commission invoices and test them against Stripe`.

### Rollout (Wouter, in this order)

1. **Billing details first.** Deploy with `PROPERTY_READINESS_ENFORCE=off`. Run `bun packages/billing/scripts/backfill-billing-profiles.ts` (dry run), review the gaps, run with `--write`, fill or chase the rest (hosts can do it on the Billing page). When every live property is ready, remove the switch and redeploy: the readiness gate is now on.
2. **R2.** Create `ob-invoices-test` (EU jurisdiction) with a **1-day** lock rule on `invoices/`; upload a file and confirm overwrite and delete are refused (`409 ObjectLockedByBucketPolicy`), then that it can be deleted after a day. Then create `ob-invoices` with the 8-year rule on `invoices/`. Tokens: one object read/write token for the job, one object read-only token for `apps/business` presigning; the admin token that can remove lock rules stays out of every app.
3. **Stripe platform webhook.** Add the "Events on your account" endpoint `https://<business-host>/api/stripe/platform-webhook` for `application_fee.created` and `application_fee.refunded`; put its secret in `STRIPE_PLATFORM_WEBHOOK_SECRET`. Remove the Platform pricing rule if it is still configured.
4. **Historical backfill, then the cron.** Run the job with `--step=backfill --from=<first month with fees> --dry-run` and review the report (unknown accounts, payments that would be returned, mismatches). Run it for real. Only then create the Scaleway Serverless Job from the `openbookings-invoice-job` image in `nl-ams` with the cron trigger and env vars from the job README, and add the Sentry cron monitor `invoice-draft`.
