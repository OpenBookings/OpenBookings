import {
  describePolicy,
  NO_SHOW_LINE,
  POLICY_VERSION,
  TIER_LABELS,
  TIER_SUMMARIES,
  type CancellationTier,
} from "@openbookings/pricing";

/** A reserved room's cancellation fields, as the support lookups return them. */
export type RoomPolicyFields = {
  /** The snapshot taken at booking; for a booking still pending, what it would get now. */
  cancellation_tier: CancellationTier;
  check_in_at: string | null;
  full_refund_until: string | null;
  cancelled_at: string | null;
};

const date = (v: string | null) => (v === null ? null : new Date(v));

/**
 * What the bot may say about a room's cancellation terms: the Annex B tier,
 * its rule in one line, and, once the booking has its snapshot, the exact
 * deadlines in the property's time zone. Grounded only in stored facts.
 */
export function policyView(room: RoomPolicyFields, timeZone: string, confirmedAt: string | null, now: Date) {
  const checkInAt = date(room.check_in_at);
  const deadlines = checkInAt
    ? describePolicy(
        {
          tier: room.cancellation_tier,
          confirmedAt: date(confirmedAt) ?? checkInAt,
          checkInAt,
          fullRefundUntil: date(room.full_refund_until),
          policyVersion: POLICY_VERSION,
        },
        timeZone,
        now,
      )
    : null;
  return {
    tier: TIER_LABELS[room.cancellation_tier],
    terms: TIER_SUMMARIES[room.cancellation_tier],
    deadlines,
    no_show: NO_SHOW_LINE,
    cancelled_at: room.cancelled_at,
  };
}
