import { formatDayMonth, formatMonthYear } from "../format";
import { addDays, endOfMonth, startOfMonth, startOfWeek, type DateRange } from "../period";
import type { Granularity, IsoDate, Point } from "../types";

export interface Bucket {
  key: IsoDate;
  label: string;
  incomplete: boolean;
}

export function bucketKey(date: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return startOfMonth(date);
}

function bucketEnd(key: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return key;
  if (granularity === "week") return addDays(key, 6);
  return endOfMonth(key);
}

function nextKey(key: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return addDays(key, 1);
  if (granularity === "week") return addDays(key, 7);
  return addDays(endOfMonth(key), 1);
}

/**
 * Every bucket the range touches, including the ones nothing happened in. A
 * bucket is incomplete when it is still in progress (it ends today or later)
 * or when the range stops before it does: either way its total is partial,
 * and drawn as a solid line it reads as a collapse.
 */
export function buckets(range: DateRange, granularity: Granularity, today: IsoDate): Bucket[] {
  const out: Bucket[] = [];
  const last = bucketKey(range.to, granularity);
  for (let key = bucketKey(range.from, granularity); key <= last; key = nextKey(key, granularity)) {
    const end = bucketEnd(key, granularity);
    out.push({
      key,
      label: granularity === "month" ? formatMonthYear(key) : formatDayMonth(key),
      incomplete: end >= today || end > range.to,
    });
  }
  return out;
}

/** Rows grouped into the range's buckets and reduced to one value each. */
export function toSeries<T>(
  rows: T[],
  date: (row: T) => IsoDate,
  range: DateRange,
  granularity: Granularity,
  today: IsoDate,
  reduce: (rows: T[], bucket: Bucket) => number | null,
): Point[] {
  const groups = new Map<IsoDate, T[]>();
  for (const row of rows) {
    const d = date(row);
    if (d < range.from || d > range.to) continue;
    const key = bucketKey(d, granularity);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return buckets(range, granularity, today).map((bucket) => ({
    bucket: bucket.key,
    label: bucket.label,
    value: reduce(groups.get(bucket.key) ?? [], bucket),
    compare: null,
    incomplete: bucket.incomplete,
  }));
}

/**
 * Lays the comparison period under the current one, position by position. The
 * two can differ in bucket count by one; a position with no counterpart stays
 * null and no value is invented for it.
 */
export function overlay(current: Point[], previous: Point[] | null): Point[] {
  if (!previous) return current;
  return current.map((point, index) => ({ ...point, compare: previous[index]?.value ?? null }));
}
