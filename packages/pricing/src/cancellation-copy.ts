/**
 * The words hosts and guests see for a cancellation policy. Kept next to the
 * calculator so the sentences and the maths can't drift apart.
 */
import type { CancellationTier, PolicySnapshot } from "./cancellation";

export const TIER_LABELS: Record<CancellationTier, string> = {
  flex: "Flex",
  standard: "Standard",
  limited: "Limited",
  non_refundable: "Non-refundable",
};

export const TIER_SUMMARIES: Record<CancellationTier, string> = {
  flex: "Free cancellation until 24 hours before check-in. After that, the first night is charged.",
  standard:
    "Free cancellation until 5 days before check-in. After that, the first night and half of the other nights are charged.",
  limited: "Free cancellation until 14 days before check-in, 50% refund until 7 days before. After that, no refund.",
  non_refundable: "No refund if you cancel. Cheaper than the refundable rate.",
};

const AFTER_DEADLINE: Record<CancellationTier, string> = {
  flex: "After that, the first night is charged and the other nights are refunded.",
  standard: "After that, the first night and half of the other nights are charged.",
  limited: "After that, no refund.",
  non_refundable: "This rate is non-refundable.",
};

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
  const at = (d: Date) => formatDeadline(d, timeZone);
  const future = (d: Date | null): d is Date => d !== null && d.getTime() > now.getTime();
  const lines: string[] = [];

  if (future(s.graceUntil) && (!s.fullRefundUntil || s.graceUntil > s.fullRefundUntil)) {
    lines.push(`Full refund if you cancel by ${at(s.graceUntil)}.`);
  }
  if (future(s.fullRefundUntil)) lines.push(`Free cancellation until ${at(s.fullRefundUntil)}.`);
  if (s.tier === "limited" && future(s.partialRefundUntil)) {
    lines.push(`50% refund if you cancel by ${at(s.partialRefundUntil)}.`);
  }
  lines.push(AFTER_DEADLINE[s.tier], TOURIST_TAX_LINE, NO_SHOW_LINE);
  return lines;
}
