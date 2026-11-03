import { z } from "zod";

/**
 * Longest span (inclusive) one edit may cover. Matches the publish path, which
 * caps a staged change at 370 dates. `setAvailability` turns a range into one
 * generate_series row per day, so without a cap `0001-01-01`..`9999-12-31` is
 * ~3.6M inserts held under the 15s statement timeout, and a handful of
 * concurrent requests from one host can exhaust the 10-connection pool.
 */
export const MAX_RANGE_DAYS = 370;

const DAY_MS = 86_400_000;

/** The instant (UTC midnight) for a YYYY-MM-DD string, or null if it isn't a real calendar date. */
export function parseIsoDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear does not.
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  // Round-trip: "2026-13-45" or "2026-02-30" roll over into a different date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime();
}

/** A real calendar date, not just something shaped like one (`2026-13-45` has the shape). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((v) => parseIsoDate(v) !== null, "Not a real calendar date");

/** Inclusive start..end, both real dates, end not before start, at most MAX_RANGE_DAYS long. */
export const dateRange = z
  .object({ startDate: isoDate, endDate: isoDate })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must not be before the start date",
    path: ["endDate"],
  })
  .refine(
    (v) => {
      const start = parseIsoDate(v.startDate);
      const end = parseIsoDate(v.endDate);
      // Unparseable dates already failed above; don't pile a second error on.
      if (start === null || end === null) return true;
      return Math.round((end - start) / DAY_MS) + 1 <= MAX_RANGE_DAYS;
    },
    { message: `Choose at most ${MAX_RANGE_DAYS} days at a time`, path: ["endDate"] },
  );
