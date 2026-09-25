import type { Point } from "./types";

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
 * A chart's aria-label, built from the chart's own numbers. A static
 * description would go stale the moment the host changes the period, and a
 * stale description of a chart is worse than none.
 */
export function trendSentence(
  label: string,
  points: Point[],
  format: (value: number) => string,
): string {
  if (points.length === 0) return `${label} has no data in this period.`;
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) {
    return `${label} was ${format(first.value)} on ${first.label}, the only point in this period.`;
  }
  const verb =
    last.value > first.value ? "rose" : last.value < first.value ? "fell" : "held steady";
  if (verb === "held steady") {
    return `${label} held steady at ${format(first.value)} from ${first.label} to ${last.label}.`;
  }
  return `${label} ${verb} from ${format(first.value)} on ${first.label} to ${format(last.value)} on ${last.label}.`;
}
