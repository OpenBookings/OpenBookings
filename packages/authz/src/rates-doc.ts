/**
 * The rates document: its id and the statement an organisation confirms.
 * Rates include VAT and mandatory fees; tourist tax is the exception, added
 * on top from the property's tourist tax rules (since 2026-10-30; the earlier
 * `rates-tax-inclusive@2026-10-02` wording had rates include tourist tax too).
 *
 * In a file of its own, with no imports, so client components can show the
 * statement without pulling the database client into the bundle.
 *
 * The id is dated. Changing the statement's wording means a new id, and every
 * organisation confirms again.
 */
export const RATES_TAX_INCLUSIVE_DOC_ID = "rates-vat-inclusive@2026-10-30";

/** Shown verbatim wherever the confirmation is asked for. */
export const RATES_TAX_INCLUSIVE_STATEMENT =
  "All rates I enter on OpenBookings include VAT and any mandatory fees, except tourist tax, which is added from the tourist tax rules I set up. Collecting and paying VAT and tourist tax to the authorities is my responsibility.";
