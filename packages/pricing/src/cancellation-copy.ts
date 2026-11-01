/**
 * The words hosts and guests see for a cancellation policy. Kept next to the
 * calculator so the sentences and the maths can't drift apart.
 */
import type { CancellationTier, PolicySnapshot } from "./cancellation";

export const TIER_LABELS: Record<CancellationTier, string> = {
  flex: "Flex",
  standard: "Standard",
  non_refundable: "Non-refundable",
};

export const TIER_SUMMARIES: Record<CancellationTier, string> = {
  flex: "Free cancellation until 24 hours before check-in. After that, the room price isn't refunded.",
  standard: "Free cancellation until 7 days before check-in. After that, the room price isn't refunded.",
  non_refundable: "No refund if you cancel. Cheaper than the refundable rate.",
};

export const EARLY_DEPARTURE_LINE =
  "If you leave early, the next 7 nights are charged and any nights after that are refunded.";
export const TOURIST_TAX_LINE = "Tourist tax is refunded for nights you don't stay.";
export const NO_SHOW_LINE = "If you don't show up, nothing is refunded.";

const deadlineFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Tue 3 Nov 2026, 15:00", in the property's time zone. */
export function formatDeadline(d: Date, timeZone: string): string {
  let f = deadlineFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    deadlineFormatters.set(timeZone, f);
  }
  const parts = f.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/**
 * The policy as sentences with exact local deadlines. Deadlines that have
 * already passed at `now` are left out.
 */
export function describePolicy(s: PolicySnapshot, timeZone: string, now: Date): string[] {
  const lines: string[] = [];
  if (s.tier === "non_refundable") {
    lines.push("This rate is non-refundable.");
  } else if (s.fullRefundUntil && s.fullRefundUntil.getTime() > now.getTime()) {
    lines.push(
      `Free cancellation until ${formatDeadline(s.fullRefundUntil, timeZone)}.`,
      "After that, the room price isn't refunded.",
    );
  } else {
    lines.push("If you cancel now, the room price isn't refunded.");
  }
  lines.push(EARLY_DEPARTURE_LINE, TOURIST_TAX_LINE, NO_SHOW_LINE);
  return lines;
}
