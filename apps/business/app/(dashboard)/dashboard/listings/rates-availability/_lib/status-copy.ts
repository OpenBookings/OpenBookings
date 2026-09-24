import type { Reason, ReasonCode, ReasonSource } from "./types";

/**
 * Every word the grid uses for a reason, in one place.
 *
 * A cell, its bar, the detail panel and the screen-reader label all describe
 * the same fact, and they have to describe it the same way — a host who reads
 * "Min 3 nt" in a cell and hears "minimum stay" from a screen reader is being
 * told about two things as far as they know.
 *
 * Chips are terse because they live in a 56px cell. The spoken phrases are
 * not: nothing is competing for that space, and an abbreviation that saves
 * four characters costs a listener the sentence.
 */

/** Terse label for the chip in a cell or on a bar. */
export function reasonChip(reason: Reason): string {
  switch (reason.code) {
    case "ROOM_CLOSED":
      return "Room closed";
    case "SOLD_OUT":
      return "Sold out";
    case "STOP_SELL":
      return "Closed";
    case "CLOSED_TO_ARRIVAL":
      return "No arrival";
    case "CLOSED_TO_DEPARTURE":
      return "No departure";
    case "MIN_STAY":
      return `Min ${reason.value ?? 1} nt`;
    case "MAX_STAY":
      return `Max ${reason.value ?? 1} nt`;
  }
}

/** Full sentence fragment, for screen readers and the detail panel. */
export function reasonPhrase(reason: Reason): string {
  switch (reason.code) {
    case "ROOM_CLOSED":
      return "the whole room type is closed";
    case "SOLD_OUT":
      return "sold out";
    case "STOP_SELL":
      return "this rate plan is closed";
    case "CLOSED_TO_ARRIVAL":
      return "guests cannot arrive on this date";
    case "CLOSED_TO_DEPARTURE":
      return "guests cannot depart on this date";
    case "MIN_STAY":
      return `minimum stay of ${reason.value ?? 1} nights`;
    case "MAX_STAY":
      return `maximum stay of ${reason.value ?? 1} nights`;
  }
}

/**
 * The chip a cell shows, plus how many reasons it could not fit.
 *
 * Only one fits, so it is the highest-precedence one — the reason the cell is
 * painted the way it is. The overflow count is there so the host knows to open
 * the panel rather than assuming they have seen everything.
 */
export function chipFor(
  reasons: Reason[],
): { label: string; overflow: number } | null {
  if (reasons.length === 0) return null;
  return {
    label: reasonChip(reasons[0]),
    overflow: reasons.length - 1,
  };
}

/** "Min 3 nt · +2" — what the chip actually renders. */
export function chipLabel(reasons: Reason[]): string | null {
  const chip = chipFor(reasons);
  if (!chip) return null;
  return chip.overflow > 0 ? `${chip.label} · +${chip.overflow}` : chip.label;
}

/** Who a reason came from, for the source pill in the detail panel. */
export function sourceLabel(source: ReasonSource): string {
  if (source.kind === "system") return "Derived";
  return source.userName ?? "A team member";
}

/**
 * Why the source pill says what it does.
 *
 * "Derived" rather than "System": nothing set it, it fell out of the
 * bookings, and calling it a system decision invites a host to look for the
 * setting that turns it off.
 */
export function sourceHint(source: ReasonSource): string {
  return source.kind === "system"
    ? "Worked out from bookings and inventory — not a setting"
    : "Set by hand";
}

/** Ordered reasons as one spoken clause: "closed, and minimum stay of 3 nights". */
export function reasonsPhrase(reasons: Reason[]): string {
  if (reasons.length === 0) return "open";
  const phrases = reasons.map(reasonPhrase);
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/** Plain-language sentence for a cell that cannot be sold. */
export const UNSELLABLE_PRICE_NOTE =
  "No sellable price while closed. The underlying rate is kept.";

/** Codes a host can lift from the cell itself, as opposed to inheriting. */
export const LOCALLY_FIXABLE = new Set<ReasonCode>([
  "STOP_SELL",
  "CLOSED_TO_ARRIVAL",
  "CLOSED_TO_DEPARTURE",
  "MIN_STAY",
  "MAX_STAY",
]);

/**
 * How the price was moved, if it was — "Manual" for an override, otherwise the
 * net effect of the modifiers that fired.
 *
 * A percentage rather than a list: at 88px there is room for one short fact,
 * and "+12%" answers "why is this different from the others?" where "Weekend
 * uplift, Last minute" only raises more questions. The panel has the full
 * build-up for anyone who wants it.
 *
 * Returns null when the cell is simply the plan's rate, which is most of them.
 */
export function adjustmentChip(cell: {
  hasOverride: boolean;
  trace: { modifier_type?: string; delta: number }[];
}): string | null {
  if (cell.hasOverride) return "Manual";

  const base = cell.trace.find((step) => !step.modifier_type)?.delta ?? 0;
  const moved = cell.trace
    .filter((step) => step.modifier_type)
    .reduce((total, step) => total + step.delta, 0);

  if (base === 0 || moved === 0) return null;

  const percent = Math.round((moved / base) * 100);
  if (percent === 0) return null;
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
}
