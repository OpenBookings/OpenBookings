import { addDays, startOfMonth, startOfWeek } from "../period";
import type { Granularity, IsoDate, Point } from "../types";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function bucketKey(date: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return startOfMonth(date);
}

export function bucketLabel(bucket: IsoDate, granularity: Granularity): string {
  const at = new Date(`${bucket}T00:00:00Z`);
  return granularity === "month" ? monthLabel.format(at) : dayLabel.format(at);
}

/**
 * Every bucket in the range, including the ones nothing happened in. A quiet
 * fortnight that closes up makes the line either side of it look steeper than
 * it was, which is the kind of wrong a host would act on.
 */
export function emptyBuckets(
  from: IsoDate,
  to: IsoDate,
  granularity: Granularity,
): IsoDate[] {
  const buckets: IsoDate[] = [];
  let cursor = bucketKey(from, granularity);
  const last = bucketKey(to, granularity);
  while (cursor <= last) {
    buckets.push(cursor);
    cursor =
      granularity === "day"
        ? addDays(cursor, 1)
        : granularity === "week"
          ? addDays(cursor, 7)
          : startOfMonth(addDays(`${cursor.slice(0, 7)}-28`, 7));
  }
  return buckets;
}

export function toSeries<T>(
  rows: T[],
  opts: {
    date: (row: T) => IsoDate;
    value: (row: T) => number;
    from: IsoDate;
    to: IsoDate;
    granularity: Granularity;
    reduce?: "sum" | "mean";
  },
): Point[] {
  const totals = new Map<IsoDate, { sum: number; count: number }>();
  for (const row of rows) {
    const key = bucketKey(opts.date(row), opts.granularity);
    const entry = totals.get(key) ?? { sum: 0, count: 0 };
    entry.sum += opts.value(row);
    entry.count += 1;
    totals.set(key, entry);
  }

  return emptyBuckets(opts.from, opts.to, opts.granularity).map((bucket) => {
    const entry = totals.get(bucket);
    const value =
      opts.reduce === "mean"
        ? entry && entry.count > 0
          ? entry.sum / entry.count
          : 0
        : (entry?.sum ?? 0);
    return { bucket, label: bucketLabel(bucket, opts.granularity), value };
  });
}
