/**
 * Client-safe pieces of the inclusive-rates gate. The gate itself is enforced
 * in actions.ts, on the server; this file holds what both sides need to agree
 * on. (actions.ts is a "use server" module and may only export functions.)
 */

export const RATES_CONFIRMATION_REQUIRED = "RATES_CONFIRMATION_REQUIRED" as const;

export const RATES_CONFIRMATION_MESSAGE =
  "Before prices can be set, an owner or admin of your organisation has to confirm that your rates include tax.";

/** Shown wherever a host types a price. */
export const RATE_INCLUSIVE_NOTICE =
  "Enter the full price the guest pays per night, including tourist tax, VAT and any mandatory fees. OpenBookings does not add tax on top, and guests are shown this price as the total.";

/**
 * Whether a staged draft changes what a guest pays. Closures, restrictions and
 * inventory blocks do not, and must stay publishable by an organisation that
 * has not confirmed yet — a host has to be able to stop selling.
 */
export function changesTouchPrice(changes: ReadonlyArray<{ type: string }>): boolean {
  return changes.some((change) => change.type === "price");
}
