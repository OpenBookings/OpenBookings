/**
 * The inclusive-rates document: its id and the statement an organisation
 * confirms. In a file of its own, with no imports, so client components can
 * show the statement without pulling the database client into the bundle.
 *
 * The id is dated. Changing the statement's wording means a new id, and every
 * organisation confirms again.
 */
export const RATES_TAX_INCLUSIVE_DOC_ID = "rates-tax-inclusive@2026-10-02";

/** Shown verbatim wherever the confirmation is asked for. */
export const RATES_TAX_INCLUSIVE_STATEMENT =
  "All rates I enter on OpenBookings include tourist tax, VAT and any mandatory fees. The price I enter is the full price the guest pays. Collecting and remitting those taxes is my responsibility.";
