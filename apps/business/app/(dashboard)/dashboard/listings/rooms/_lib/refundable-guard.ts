import { nonRefundableQualifies } from "@openbookings/pricing";

/**
 * Annex B B.4: a Non-refundable rate may only sell next to a refundable rate on
 * the same room that costs at least 10% more. Checked on the base rate (BAR)
 * whenever a rate's status or refund type changes. Date overrides can still
 * break it for particular stays, so the guest side checks each stay again and
 * hides a Non-refundable rate that no longer qualifies.
 */

export interface GuardRate {
  id: string;
  isActive: boolean;
  isRefundable: boolean;
  bar: number;
}

export const NON_REFUNDABLE_MESSAGE =
  "A non-refundable rate needs a refundable rate on this room that costs at least 10% more.";
export const DEPENDS_MESSAGE =
  "This room's non-refundable rate depends on this rate. Change or deactivate that one first.";

/**
 * `rates` are the room's non-archived rates as they are now (the one being
 * changed may be among them); `next` is
 * the rate being saved as it would be after the change (an archive is
 * `isActive: false`). Returns the refusal, or null when the room still keeps
 * the rule.
 */
export function refundableGuardError(rates: GuardRate[], next: GuardRate): string | null {
  const after = [...rates.filter((r) => r.id !== next.id), next];
  const failsBefore = failing(rates);
  // Another rate this change breaks comes first: that is the thing to fix.
  // A rate that already failed (R&A moved a price) is not this save's fault.
  const broken = [...failing(after)].filter((id) => id !== next.id && !failsBefore.has(id));
  if (broken.length > 0) return DEPENDS_MESSAGE;
  return failing(after).has(next.id) ? NON_REFUNDABLE_MESSAGE : null;
}

/** Ids of the active Non-refundable rates that don't keep the 10% rule. */
function failing(rates: GuardRate[]): Set<string> {
  const refundableBars = rates.filter((r) => r.isActive && r.isRefundable).map((r) => r.bar);
  return new Set(
    rates
      .filter((r) => r.isActive && !r.isRefundable && !nonRefundableQualifies(r.bar, refundableBars))
      .map((r) => r.id),
  );
}
