# Tax-Inclusive Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Written for native execution in the session that wrote it: each task names its files, interfaces and test cases; code is written test-first during execution rather than duplicated here.

**Goal:** The price a host enters is the price a guest pays: hosts confirm on record that rates include tax, the server refuses price changes without that confirmation, and checkout stops adding tourist tax on top.

**Architecture:** The confirmation is one row in the existing `org_consent` table under a dated `doc_id`. A single predicate in `packages/authz` answers "has this property's organisation confirmed?", and it is called from the two price-writing server actions and from the guest checkout. The checkout's tax line is removed. A shared notice component states the rule wherever a price is typed.

**Tech Stack:** Next.js server actions, Postgres (`org_consent`), Bun test.

**Spec:** `docs/compliance/specs/2026-10-02-tax-inclusive-rates-design.md`

## Global Constraints

- `doc_id` is exactly `rates-tax-inclusive@2026-10-02`. A wording change means a new dated id and re-confirmation.
- Statement confirmed, verbatim: "All rates I enter on OpenBookings include tourist tax, VAT and any mandatory fees. The price I enter is the full price the guest pays. Collecting and remitting those taxes is my responsibility."
- Notice at price entry, verbatim: "Enter the full price the guest pays per night, including tourist tax, VAT and any mandatory fees. OpenBookings does not add tax on top, and guests are shown this price as the total."
- The server is the gate, not the UI: `createRatePlan` and any `publishAriChanges` containing a price change fail without a confirmation. A publish with no price change is not blocked.
- Checkout refuses a property whose organisation has not confirmed.
- A property with no organisation (`organization_id IS NULL`) counts as unconfirmed (fail closed).
- Checkout adds no tax line for any `tax_rate`. `properties.tax_rate` stays in the schema, unread by pricing.
- Only an organisation owner or admin can confirm.
- No guest-facing tax breakdown.

## Review Focus

1. **A host publishes a draft that mixes a price change with a closure, unconfirmed** — the whole publish is refused (it is one transaction), with a message that says why. (Task 2.)
2. **A property with no organisation** — price writes and checkout are refused, not allowed. (Task 1.)
3. **A manager (not owner/admin) opens Rates & Availability on an unconfirmed organisation** — they see why prices are locked and who can unlock them; they cannot confirm. (Task 3.)
4. **Double-click on Confirm** — one consent row, no error. (Task 3.)
5. **A property with `tax_rate > 0`** — guest total equals nights × price, no tax line. (Task 4.)

---

### Task 1: The confirmation predicate

**Files:** modify `packages/authz/src/index.ts`, `packages/authz/src/index.test.ts`.

**Produces:**
```ts
export const RATES_TAX_INCLUSIVE_DOC_ID = "rates-tax-inclusive@2026-10-02";
/** True when the organisation that owns the property has confirmed inclusive rates. */
export function propertyRatesConfirmed(propertyId: string, deps?: AuthzDeps): Promise<boolean>;
export function roomRatesConfirmed(roomId: string, deps?: AuthzDeps): Promise<boolean>;
export function ratePlanRatesConfirmed(ratePlanId: string, deps?: AuthzDeps): Promise<boolean>;
```
**Tests (fake `queryOne`, as the existing suite does):** confirmed org → true; unconfirmed → false; property with null organisation → false; a confirmation under an older doc id → false; room and rate-plan variants resolve through to the property.

### Task 2: Gate the price-writing actions

**Files:** modify `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/actions.ts`; create `_lib/rates-confirmation.ts` (pure helper `changesTouchPrice(changes)`) and its test.

- `createRatePlan`: after the ownership check, `roomRatesConfirmed(roomId)`; on false return `{ ok: false, error: RATES_CONFIRMATION_MESSAGE, code: 'RATES_CONFIRMATION_REQUIRED' }`.
- `publishAriChanges`: when `changesTouchPrice(data.changes)`, check `propertyRatesConfirmed(data.propertyId)` inside the transaction; refuse with the same code.
- `ActionResult` and `PublishResult` failure variants gain optional `code?: 'RATES_CONFIRMATION_REQUIRED'`.
- New action `confirmInclusiveRates(propertyId)`: owner/admin of the property's organisation only; inserts the `org_consent` row with signer name, role and IP (same columns the Partner Agreement uses); idempotent (no second row if one exists).

**Tests:** `changesTouchPrice` for each change type; a draft of closures only → false; one price among many → true.

### Task 3: Notice and confirmation UI

**Files:** create `_components/rate-inclusive-notice.tsx`, `_components/rates-confirmation-dialog.tsx`; modify `edit-dialogs.tsx` (notice under Base rate), `range-action-bar.tsx` (compact notice), `ari-toolbar.tsx` ("Rates include tax" note), `ari-view.tsx` and `page.tsx` (load confirmation state; open the dialog when unconfirmed or on `RATES_CONFIRMATION_REQUIRED`).

- Dialog shows the statement verbatim, a checkbox, and Confirm. Non-owners see the statement and "Ask an owner or admin of your organisation to confirm" with no Confirm button.
- Onboarding: `provisionOrganization` writes the confirmation row alongside the Partner Agreement when the legal step carries it; the legal step gets a required checkbox with the same statement.

### Task 4: Checkout

**Files:** modify `apps/web/app/checkout/_lib/booking.ts` (remove the tax line and `tax_rate` select; add `rates_confirmed` to the query), `apps/web/app/api/checkout/route.ts` (refuse unconfirmed with `config_error`), `packages/db/src/schema.ts` (comment on `taxRate`), `packages/pricing/src/calculator.ts` (doc comment on `total_price`); create `apps/web/app/checkout/_lib/booking-lines.ts` (pure `buildBookingLines(row)`) and its test.

**Tests:** `buildBookingLines` returns exactly one room line for `tax_rate` 0 and 0.07; unit × quantity equals price × nights.

### Task 5: Existing data and docs

**Files:** create `packages/db/scripts/list-tax-rate-properties.ts` (read-only: property, organisation, owner email, `tax_rate`, active rate plans, confirmed yes/no); modify `packages/db/seed/demo-booking.ts` (confirmation row for the demo organisation; no tax in totals); modify the rates page in `apps/docs` to state the inclusive basis.

## Left for Wouter

- Run `list-tax-rate-properties.ts` and contact those hosts before release.
- On release day every existing organisation is unconfirmed, so their properties are not bookable until an owner confirms.
- Partner Agreement: rates are entered tax-inclusive; remitting tax is the host's responsibility; commission is taken on the full guest price.
- Properties with no organisation (`organization_id IS NULL`) can never be confirmed and are not bookable; the listing script marks them "(none: cannot confirm)". They need an organisation backfilled by hand.
- Not built: database-backed tests for the gate (`createRatePlan`, `publishAriChanges`, checkout refusal). The suite has such tests but they need a database, which was not available when this was written.
