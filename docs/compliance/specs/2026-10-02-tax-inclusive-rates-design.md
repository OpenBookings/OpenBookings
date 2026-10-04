# Tax-inclusive rates — design

**Date:** 2 October 2026
**Closes:** audit B1 (all-in price), B2 (tourist tax)
**Status:** approved and implemented (branch `compliance/tax-inclusive-rates`)

## Decision (from Wouter)

The price a host enters is the price the guest pays. Hosts are told, at the
moment they set a price, that the rate must include tourist tax (and any other
tax or mandatory fee). The platform does not add tax on top.

## What is wrong today

- `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx:419` prints
  "Incl. Tax & Fees" under the raw rate.
- `apps/web/app/checkout/_lib/booking.ts:279-285` adds a "Tourist tax" line of
  `price × nights × properties.tax_rate` at checkout. So the label is false
  whenever `tax_rate > 0`, and once rates are entered tax-inclusive the guest
  would pay the tax twice.
- Nothing tells the host which basis to use.

## Design

### 1. Host statement at every price entry

One shared component, `RateInclusiveNotice`, in
`apps/business/app/(dashboard)/dashboard/listings/rates-availability/_components/`:

> Enter the full price the guest pays per night, including tourist tax, VAT
> and any mandatory fees. OpenBookings does not add tax on top, and guests are
> shown this price as the total.

Placed under:

- the "Base rate" field in the Add rate plan dialog (`edit-dialogs.tsx`),
- the price field in `range-action-bar.tsx` (compact form, as helper text or
  tooltip beside "Set price"),
- any other field that writes `rate_plans.bar` or `rate_overrides`.

The Rates & Availability page also gets a one-line persistent note in the
toolbar ("Rates include tax") so the basis is visible when reading the grid,
not only when editing.

### 1b. The gate: no price without a recorded confirmation

The notice alone is advice. To make inclusive pricing a rule, the organisation
has to confirm it once, on record, and the server refuses price writes without
that record.

- **Record.** A row in the existing `org_consent` table (the table that holds
  the signed Partner Agreement), `doc_id = 'rates-tax-inclusive@2026-10-02'`,
  with signer, name and timestamp. No new table.
- **Statement confirmed.** "All rates I enter on OpenBookings include tourist
  tax, VAT and any mandatory fees. The price I enter is the full price the
  guest pays. Collecting and remitting those taxes is my responsibility."
- **Where it is asked.**
  - New hosts: a required checkbox in the onboarding legal step
    (`legal-n-boring.tsx`), written alongside the agreement signature.
  - Existing hosts: a blocking dialog the first time they open Rates &
    Availability or try to save a price.
- **Server enforcement.** A helper `orgHasConfirmedInclusiveRates(orgId)` in
  `packages/authz`. `createRatePlan` and `publishAriChanges` (when the draft
  contains a price) in `rates-availability/_lib/actions.ts` return a typed
  `RATES_CONFIRMATION_REQUIRED` failure without it. The UI is not the gate.
- **Guest side.** `apps/web/app/api/checkout/route.ts` refuses a booking for a
  property whose organisation has no confirmation, with the existing
  "not bookable" error. A price that was never confirmed as inclusive is not
  sold as "incl. tax".
- **Re-confirmation.** Changing the statement's wording means a new `doc_id`
  date and every organisation confirms again.

### 2. Checkout stops adding tax

In `booking.ts`: remove the `taxRate > 0` branch and the `p.tax_rate` select.
The lines are the room nights only, and their sum is the amount charged.
"Total incl. tax & fees" in `TripSummary.tsx:290` is then true.

`assertChargeable` in `apps/web/app/api/checkout/route.ts` re-validates the
amount server-side; its expectation changes with the lines and its tests are
updated in the same change.

### 3. `properties.tax_rate`

Kept in the schema, no longer read by pricing or checkout. Reason: dropping a
column is a separate, irreversible migration and the value may be wanted later
for host reporting. A comment on the column in `schema.ts` records that it is
informational and must not be added to a guest price.

No "of which tourist tax" breakdown is shown to guests. A single percentage
cannot represent per-person-per-night taxes, and a wrong breakdown is worse
than none.

### 4. Calculator

`packages/pricing/src/calculator.ts` needs no tax field: with inclusive rates
`total_price` is already all-in. The doc comment on `ResolvedRoom.total_price`
states that it is tax-inclusive by contract with the host.

### 5. Listing page price

`RoomsCarousel.tsx:416` renders `rate.bar`, the base rate, not the price for
the selected dates. That is a separate defect from the tax label: with
modifiers or overrides the number can differ from what checkout charges. In
this change the label becomes true for tax; rendering the resolved price for
the selected stay is recorded as a follow-up, not done here.

### 6. Existing data

Rates already entered were entered without a stated basis.

- Properties with `tax_rate = 0`: nothing changes for the guest.
- Properties with `tax_rate > 0`: their guest price drops by the tax amount
  when checkout stops adding it. A read-only script,
  `packages/db/scripts/list-tax-rate-properties.ts`, lists them (property,
  organisation, owner email, `tax_rate`, number of active rate plans) so they
  can be contacted before release.
- Every existing organisation is unconfirmed on release day, so the gate in
  §1b makes each of them review and confirm before they can change a price,
  and before guests can book. The release therefore needs the list above
  worked through first, or live properties stop being bookable until the host
  confirms.
- The seeded demo organisation gets a confirmation row;
  `packages/db/seed/demo-booking.ts` is updated to match.

### 7. Host docs and agreement

- `apps/docs`: the rates page states the inclusive basis.
- Flag for Wouter: the Partner Agreement should say rates are entered
  tax-inclusive and that remitting tourist tax is the host's responsibility.
  That is a contract change, outside this code change.

## Testing

- `booking.ts`: no tax line for any `tax_rate`; lines sum to the booking total.
- Checkout route: `assertChargeable` passes for the seeded booking after the
  change.
- Component test: the notice renders in the Add rate plan dialog and the
  range action bar.
- Gate: `createRatePlan` and a price-carrying `publishAriChanges` fail without
  a confirmation row and succeed with one; a publish with no price change is
  not blocked; checkout refuses an unconfirmed organisation's property.

## Out of scope

- Per-person-per-night tourist tax modelling.
- Tax payable at the property.
- A separate commission base. With inclusive rates there is no pre-tax figure
  to compute from, so the 4.5% commission is taken on the full guest price
  (Stripe spec §4). Flag for Wouter: this means commission is also earned on
  the tourist-tax part of the price; the Partner Agreement should say so.
