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

function deadlineParts(d: Date, timeZone: string) {
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
  return {
    weekday: get("weekday"),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** "Tue 3 Nov 2026, 15:00", in the property's time zone. */
export function formatDeadline(d: Date, timeZone: string): string {
  const p = deadlineParts(d, timeZone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.time}`;
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

export type PolicyStep = {
  kind: "free" | "after" | "no_show" | "non_refundable";
  title: string;
  detail: string;
  /** `free` steps only: the deadline as an ISO instant, to compare across rooms. */
  until?: string;
  /** `free` steps only: the deadline as the title words it, e.g. "Thu 10 Dec, 14:00". */
  deadlineLabel?: string;
};

const NO_SHOW_STEP: PolicyStep = {
  kind: "no_show",
  title: "If you don't show up",
  detail: "The hotel keeps the full amount.",
};

/**
 * The policy as a timeline of steps, for the checkout schedule. Words and
 * dates only, no amounts. A passed free-cancellation deadline drops that step.
 */
export function describePolicySteps(s: PolicySnapshot, timeZone: string, now: Date): PolicyStep[] {
  if (s.tier === "non_refundable") {
    return [
      {
        kind: "non_refundable",
        title: "Non-refundable",
        detail: "The room isn't refunded if you cancel. Tourist tax for nights you don't stay is.",
      },
      NO_SHOW_STEP,
    ];
  }
  const steps: PolicyStep[] = [];
  if (s.fullRefundUntil && s.fullRefundUntil.getTime() > now.getTime()) {
    const p = deadlineParts(s.fullRefundUntil, timeZone);
    const deadlineLabel = `${p.weekday} ${p.day} ${p.month}, ${p.time}`;
    steps.push({
      kind: "free",
      title: `Free until ${deadlineLabel}`,
      detail: "Cancel before then and you get everything you paid back.",
      until: s.fullRefundUntil.toISOString(),
      deadlineLabel,
    });
  }
  steps.push({
    kind: "after",
    title: "After that",
    detail: "The room isn't refunded. Tourist tax for nights you don't stay is.",
  });
  steps.push(NO_SHOW_STEP);
  return steps;
}
