/**
 * Bounds for the public search query, which is unauthenticated and runs a
 * generate_series over the stay (see buildHotelSearchQuery). Without them,
 * `checkin=0001-01-01&checkout=9999-12-31` asks Postgres for ~3.6M stay dates
 * per candidate rate plan, and a reversed range or an impossible date such as
 * `2026-02-30` turns into a 500 rather than a clean 400.
 */

/** Longest stay a search will price. Anything longer is not a holiday booking. */
export const MAX_SEARCH_NIGHTS = 30;

const DAY_MS = 86_400_000;

/** UTC midnight for a real YYYY-MM-DD calendar date, or null (e.g. "2026-02-30", "2026-1-5"). */
export function parseSearchDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day); // setUTCFullYear: Date.UTC maps years 0-99 to 19xx
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime();
}

/** Validation messages for a parsed search; empty when it is within bounds. */
export function searchBoundErrors(i: { lat: number; lon: number; checkin: string; checkout: string }): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(i.lat) || i.lat < -90 || i.lat > 90) errors.push("lat must be between -90 and 90");
  if (!Number.isFinite(i.lon) || i.lon < -180 || i.lon > 180) errors.push("lon must be between -180 and 180");

  const arrival = parseSearchDate(i.checkin);
  const departure = parseSearchDate(i.checkout);
  if (arrival === null) errors.push("checkin must be a valid date (YYYY-MM-DD)");
  if (departure === null) errors.push("checkout must be a valid date (YYYY-MM-DD)");
  if (arrival !== null && departure !== null) {
    const nights = Math.round((departure - arrival) / DAY_MS);
    if (nights < 1) errors.push("checkout must be after checkin");
    else if (nights > MAX_SEARCH_NIGHTS) errors.push(`stay cannot be longer than ${MAX_SEARCH_NIGHTS} nights`);
  }
  return errors;
}
