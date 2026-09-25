import type { Granularity, IsoDate } from "./types";

/**
 * Every date in analytics is a `YYYY-MM-DD` string and every calculation on it
 * runs in UTC. A Date built from a local timestamp reads back a different day
 * either side of a DST change, and reads back a different day again on a server
 * in UTC than in a browser in CET — a hydration mismatch that surfaces twice a
 * year and is nearly impossible to reproduce on purpose.
 */
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True only for a well-formed date that survives a round trip, so "2026-13-45" fails. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Inclusive of both ends: a single day is 1, not 0. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: IsoDate): number {
  return ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, -(weekdayOf(date) - 1));
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 0));
}

export function enumerateDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type PeriodPreset =
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "ytd"
  | "last-12-months"
  | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-3-months": "Last 3 months",
  ytd: "Year to date",
  "last-12-months": "Last 12 months",
  custom: "Custom range",
};

export const PERIOD_PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[];

export interface Period {
  preset: PeriodPreset;
  from: IsoDate;
  to: IsoDate;
}

/** One URL must not be able to ask for the whole history at daily grain. */
const MAX_CUSTOM_DAYS = 366 * 5;

export function resolvePeriod(
  preset: PeriodPreset,
  today: IsoDate,
  custom?: { from?: string; to?: string },
): Period {
  switch (preset) {
    case "this-month":
      return { preset, from: startOfMonth(today), to: today };
    case "last-month": {
      const lastMonthDay = addDays(startOfMonth(today), -1);
      return { preset, from: startOfMonth(lastMonthDay), to: endOfMonth(lastMonthDay) };
    }
    case "last-3-months":
      // 3 months back, then forward one day, so the span is inclusive.
      return { preset, from: addDays(shiftMonths(today, -3), 1), to: today };
    case "ytd":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last-12-months":
      return { preset, from: addDays(shiftMonths(today, -12), 1), to: today };
    case "custom": {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to)) {
        return resolvePeriod("this-month", today);
      }
      // Swapped rather than rejected: a host dragging backwards through the
      // Calendar produces from > to for the length of the drag, and blanking
      // the page mid-gesture is not a useful answer to a half-finished range.
      let [from, to] =
        custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS) from = addDays(to, -(MAX_CUSTOM_DAYS - 1));
      return { preset, from, to };
    }
  }
}

/** Clamps to the last day of the target month, so 31 March minus one month is 28/29 February. */
function shiftMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)),
  );
}

/** Query params are user input. Anything unrecognised falls back; nothing throws. */
export function parsePeriodParams(
  params: { period?: string; from?: string; to?: string },
  today: IsoDate,
): Period {
  const preset = (PERIOD_PRESETS as string[]).includes(params.period ?? "")
    ? (params.period as PeriodPreset)
    : "this-month";
  return resolvePeriod(preset, today, { from: params.from, to: params.to });
}

/**
 * One decision, in one place. If the revenue chart and the sell-through chart
 * each chose their own granularity they would eventually disagree, and a host
 * comparing the two would be comparing different weeks.
 */
export function granularityFor(period: Pick<Period, "from" | "to">): Granularity {
  const days = daysBetween(period.from, period.to);
  if (days <= 31) return "day";
  // 182 days is 26 whole weeks, so the weekly chart never draws more than 26
  // bars. A day past it is monthly: "six months" from 1 January is 181 days,
  // and the boundary is asserted in the tests rather than left to a constant.
  if (days <= 182) return "week";
  return "month";
}

/** Null when the comparison span would run before any data could exist. */
export function comparisonRange(period: Period): { from: IsoDate; to: IsoDate } | null {
  if (period.preset === "ytd") {
    return { from: shiftYears(period.from, -1), to: shiftYears(period.to, -1) };
  }
  const days = daysBetween(period.from, period.to);
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

function shiftYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return fromUtc(Date.UTC(y + years, m - 1, Math.min(d, lastDay)));
}
