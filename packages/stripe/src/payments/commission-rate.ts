/**
 * OpenBookings' standard commission: 4.5% of the room price including VAT
 * (VAT on our fee included). Never charged on tourist tax, cots or extra beds.
 *
 * A booking charges the rate stored on its property (`properties.commission_rate`),
 * which defaults to this value. Marketing copy, calculators and demo data read
 * it from here so they can't drift from each other. Legal text and docs state
 * the number literally on purpose.
 *
 * No Stripe SDK import here: client components can use this module through
 * `@openbookings/stripe/commission-rate`.
 */
export const DEFAULT_COMMISSION_RATE = 0.045;

/** A commission rate as a short percentage, e.g. 0.045 → "4.5%". */
export function formatCommissionRate(rate: number = DEFAULT_COMMISSION_RATE): string {
  // Round to 2 decimals of a percent, then drop trailing zeros: 0.045 → "4.5".
  const percent = Number((rate * 100).toFixed(2));
  return `${percent}%`;
}

/** The default rate's label, "4.5%". */
export const DEFAULT_COMMISSION_LABEL = formatCommissionRate(DEFAULT_COMMISSION_RATE);
