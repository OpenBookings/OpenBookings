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
  | "last-7-days"
  | "last-30-days"
  | "last-3-months"
  | "last-12-months"
  | "ytd"
  | "custom";

export const DEFAULT_PRESET: PeriodPreset = "last-3-months";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "last-7-days": "Last 7 days",
  "last-30-days": "Last 30 days",
  "last-3-months": "Last 3 months",
  "last-12-months": "Last 12 months",
  ytd: "Year to date",
  custom: "Custom",
};

export const PERIOD_PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[];

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface Period extends DateRange {
  preset: PeriodPreset;
}

export type CompareMode = "none" | "previous" | "last-year";

export const DEFAULT_COMPARE: CompareMode = "previous";

export const COMPARE_LABELS: Record<CompareMode, string> = {
  none: "No comparison",
  previous: "Previous period",
  "last-year": "Same period last year",
};

export const COMPARE_MODES = Object.keys(COMPARE_LABELS) as CompareMode[];

/** Search params as Next hands them over: a repeated key arrives as an array. */
export type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** One URL must not be able to ask for the whole history at daily grain. */
const MAX_CUSTOM_DAYS = 366 * 5;

export function resolvePeriod(
  preset: PeriodPreset,
  today: IsoDate,
  custom?: { from?: string; to?: string },
): Period {
  switch (preset) {
    case "last-7-days":
      return { preset, from: addDays(today, -6), to: today };
    case "last-30-days":
      return { preset, from: addDays(today, -29), to: today };
    case "last-3-months":
      // 3 months back, then forward one day, so the span is inclusive.
      return { preset, from: addDays(shiftMonths(today, -3), 1), to: today };
    case "last-12-months":
      return { preset, from: addDays(shiftMonths(today, -12), 1), to: today };
    case "ytd":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom": {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to)) {
        return resolvePeriod(DEFAULT_PRESET, today);
      }
      // Swapped rather than rejected: dragging backwards through the calendar
      // produces from > to for the length of the drag.
      const forwards = custom.from <= custom.to;
      const to = forwards ? custom.to : custom.from;
      let from = forwards ? custom.from : custom.to;
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
  return fromUtc(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
}

export function shiftYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return fromUtc(Date.UTC(y + years, m - 1, Math.min(d, lastDay)));
}

/** Query params are user input. Anything unrecognised falls back; nothing throws. */
export function parsePeriodParams(params: RawParams, today: IsoDate): Period {
  const requested = first(params.period) ?? "";
  const preset = (PERIOD_PRESETS as string[]).includes(requested)
    ? (requested as PeriodPreset)
    : DEFAULT_PRESET;
  return resolvePeriod(preset, today, { from: first(params.from), to: first(params.to) });
}

export function parseCompareParam(value: string | string[] | undefined): CompareMode {
  const requested = first(value) ?? "";
  return (COMPARE_MODES as string[]).includes(requested) ? (requested as CompareMode) : DEFAULT_COMPARE;
}

/**
 * One decision, in one place: daily up to 31 days, weekly up to 26 whole weeks
 * (182 days), monthly beyond.
 */
export function granularityFor(range: DateRange): Granularity {
  const days = daysBetween(range.from, range.to);
  if (days <= 31) return "day";
  if (days <= 182) return "week";
  return "month";
}

export function comparisonRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "none") return null;
  if (mode === "last-year") {
    return { from: shiftYears(range.from, -1), to: shiftYears(range.to, -1) };
  }
  const days = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

const AMSTERDAM_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The host's calendar day. A server in UTC would otherwise call it yesterday
 * for the last hour or two of every Amsterdam evening.
 */
export function amsterdamToday(now: Date = new Date()): IsoDate {
  const parts = Object.fromEntries(AMSTERDAM_PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
