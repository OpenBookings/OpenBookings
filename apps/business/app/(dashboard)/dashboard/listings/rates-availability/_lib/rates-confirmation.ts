/**
 * Client-safe pieces of the inclusive-rates gate. The gate itself is enforced
 * in actions.ts, on the server; this file holds what both sides need to agree
 * on. (actions.ts is a "use server" module and may only export functions.)
 */

export const RATES_CONFIRMATION_REQUIRED = "RATES_CONFIRMATION_REQUIRED" as const;

export const RATES_CONFIRMATION_MESSAGE =
  "Before prices can be set, an owner or admin of your organisation has to confirm that your rates include VAT and any mandatory fees.";

/** Shown wherever a host types a price; kept beside the confirmed statement. */
export { RATE_INCLUSIVE_NOTICE } from "@openbookings/authz/rates-doc";

/**
 * Whether a staged draft changes what a guest pays. Closures, restrictions and
 * inventory blocks do not, and must stay publishable by an organisation that
 * has not confirmed yet — a host has to be able to stop selling.
 */
export function changesTouchPrice(changes: ReadonlyArray<{ type: string }>): boolean {
  return changes.some((change) => change.type === "price");
}

/**
 * The rate plans a draft would price. The gate is checked against these, not
 * against the property id the client sends: that id is only a claim, and a
 * crafted request could name someone else's confirmed property.
 */
export function pricedRatePlanIds(
  changes: ReadonlyArray<{ type: string; ratePlanId?: string }>,
): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.type === "price" && change.ratePlanId) ids.add(change.ratePlanId);
  }
  return [...ids];
}
