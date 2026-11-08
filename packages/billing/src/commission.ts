import { splitInclusive, vatRateBp, type VatTreatment } from "./vat";

/**
 * Splits a commission fee (VAT-inclusive, in cents) into its net and VAT
 * parts for the given treatment. Numbers go in and out at the boundary; the
 * maths runs in bigint. Throws unless `feeCents` is a non-negative safe integer.
 */
export function commissionSplit(input: {
  feeCents: number;
  treatment: VatTreatment;
}): { netCents: number; vatCents: number } {
  if (!Number.isSafeInteger(input.feeCents) || input.feeCents < 0) {
    throw new Error(`Commission fee must be a non-negative whole number of cents, got ${input.feeCents}`);
  }
  const { net, vat } = splitInclusive(BigInt(input.feeCents), vatRateBp(input.treatment));
  return { netCents: Number(net), vatCents: Number(vat) };
}
