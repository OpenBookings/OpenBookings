import type { IsoDate, Point } from "./types";

/** An absent number is an em dash everywhere. €0 and "we cannot say" are different claims. */
export const EM_DASH = "—";

/**
 * en-GB, not en-NL. "en-NL" is a hybrid CLDR resolves differently per engine:
 * Bun renders "€ 4.523,90" and Node "€4,523.90" from the same call, and a
 * browser is a third implementation — which would mismatch hydration on every
 * money figure on the page, and make the unit tests describe something the host
 * never sees. en-GB is stable across all three and matches what this app already
 * renders on the server today.
 */
const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const counts = new Intl.NumberFormat("en-GB");

export function formatCents(cents: number | null): string {
  return cents === null ? EM_DASH : money.format(cents / 100);
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

const wholeEuros = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Stats and chart axes. Cents belong in tables and the CSV: use formatCents there. */
export function formatEuros(cents: number | null): string {
  return cents === null ? EM_DASH : wholeEuros.format(Math.round(cents / 100));
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
