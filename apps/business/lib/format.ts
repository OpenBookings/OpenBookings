const relativeTimeFormatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
  { amount: 4.34524, unit: "weeks" },
  { amount: 12, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
];

/** e.g. "2 hours ago", "yesterday", "3 weeks ago". */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  let duration = (d.getTime() - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relativeTimeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return relativeTimeFormatter.format(Math.round(duration), "years");
}

/** "14:32" for today, "20 Jul" otherwise — for message timestamps. */
export function formatMessageTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? timeFormatter.format(d) : dateFormatter.format(d);
}
