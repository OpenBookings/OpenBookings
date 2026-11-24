import { formatCents as money, roundHalfUp } from "@openbookings/pricing/money";
import type { IsoDate, Point } from "./types";

/** An absent number is an em dash everywhere. €0 and "we cannot say" are different claims. */
export const EM_DASH = "—";

const counts = new Intl.NumberFormat("en-GB");

/**
 * "€4,523.90" for tables. Averages can fall between cents, so they
 * round half up to the cent first. The shared formatter is plain string
 * arithmetic: no Intl locale that Bun, Node and the browser resolve differently.
 */
export function formatCents(cents: number | null): string {
  return cents === null ? EM_DASH : money(roundHalfUp(cents), { whole: "always-decimals" });
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? EM_DASH : `${value.toFixed(digits)}%`;
}

export function formatCount(value: number | null): string {
  return value === null ? EM_DASH : counts.format(value);
}

export function formatNights(value: number | null): string {
  if (value === null) return EM_DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "night" : "nights"}`;
}

/**
 * Month names written here rather than asked of Intl. CLDR 42 renamed the
 * English abbreviation for September from "Sep" to "Sept", so `month: "short"`
 * returns whichever of the two the running engine's ICU happens to carry: Bun
 * on macOS says "21 Sep", Bun on Linux (what CI runs) and Node say "21 Sept".
 * That is an axis label that changes between a developer's machine, CI, the
 * server render and the browser — the same hazard the money formatter above
 * documents. Three letters, fixed here, read the same everywhere.
 */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2026-09-21" -> "21 Sep". Reads the ISO parts directly; no Date, no timezone. */
export function formatDayMonth(date: IsoDate): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

/** "2026-09-01" -> "Sep 2026". */
export function formatMonthYear(date: IsoDate): string {
  const [year, month] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * A chart's aria-label, built from the chart's own numbers. A static
 * description would go stale the moment the host changes the period, and a
 * stale description of a chart is worse than none.
 */
export function trendSentence(
  label: string,
  points: Pick<Point, "label" | "value">[],
  format: (value: number) => string,
): string {
  const known = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (known.length === 0) return `${label} has no data in this period.`;
  const first = known[0];
  const last = known[known.length - 1];
  if (known.length === 1) {
    return `${label} was ${format(first.value)} on ${first.label}, the only point in this period.`;
  }
  const verb =
    last.value > first.value ? "rose" : last.value < first.value ? "fell" : "held steady";
  if (verb === "held steady") {
    return `${label} held steady at ${format(first.value)} from ${first.label} to ${last.label}.`;
  }
  return `${label} ${verb} from ${format(first.value)} on ${first.label} to ${format(last.value)} on ${last.label}.`;
}

/** Stats and chart axes. Cents belong in tables and the CSV: use formatCents there. */
export function formatEuros(cents: number | null): string {
  return cents === null ? EM_DASH : money(roundHalfUp(cents / 100) * 100);
}

/** "2026-10-01" -> "1 Oct 2026". */
export function formatDate(date: IsoDate): string {
  return `${formatDayMonth(date)} ${date.slice(0, 4)}`;
}

export function formatRange(range: { from: IsoDate; to: IsoDate }): string {
  return `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

export function formatDays(value: number | null): string {
  if (value === null) return EM_DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** Index 0 is Monday, matching `weekdayOf(date) - 1`. */
export const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;
