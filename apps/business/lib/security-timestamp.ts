// en-GB like lib/format.ts: day-first dates and a 24-hour clock.
const LOCALE = "en-GB";

/** Calendar day in the zone, as a count of days, so two of them can be compared. */
function dayNumber(date: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
}

/**
 * "Today, 18:38", "Yesterday, 23:59" or "8 Oct 2026, 09:07" — by calendar day
 * in the viewer's time zone, not by hours elapsed. Null when there is no
 * usable date, so the caller can leave the text out instead of printing a dash.
 *
 * `timeZone` defaults to the browser's; it is a parameter for the tests.
 */
export function formatSecurityTimestamp(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  const daysAgo = dayNumber(now, timeZone) - dayNumber(date, timeZone);
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;

  const day = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${day}, ${time}`;
}
