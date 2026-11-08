const TIME_ZONE = "Europe/Amsterdam";

/** A calendar month in Europe/Amsterdam, as dates and as instants. */
export type Period = {
  /** First day, `YYYY-MM-01`. */
  start: string;
  /** Last calendar day, `YYYY-MM-DD`. */
  end: string;
  /** Inclusive start instant: midnight Amsterdam on the first day. */
  from: Date;
  /** Exclusive end instant: midnight Amsterdam on the first of the next month. */
  to: Date;
};

const offsetFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  timeZoneName: "longOffset",
});

const monthFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

/** Amsterdam's offset from UTC in milliseconds at the given instant. */
function offsetMs(at: Date): number {
  const name = offsetFormat
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = name?.match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/);
  if (!match) throw new Error(`Unreadable time zone offset: ${name}`);
  if (!match[1]) return 0;
  const ms = (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  return match[1] === "-" ? -ms : ms;
}

/** The instant of midnight Amsterdam on the first day of the given month. */
function monthStart(year: number, month: number): Date {
  const utcMidnight = Date.UTC(year, month - 1, 1);
  // Sample the offset at noon: DST changes on Sundays at night, never on the
  // 1st at midnight, so the offset at noon is the one in force at midnight.
  const offset = offsetMs(new Date(utcMidnight + 12 * 3_600_000));
  return new Date(utcMidnight - offset);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The billing period for a `YYYY-MM` string. Throws on anything else
 * (`2026-13`, `2026-1`, `abc`).
 */
export function periodFor(yyyyMm: string): Period {
  const match = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  if (!match || month < 1 || month > 12) {
    throw new RangeError(`Invalid period "${yyyyMm}", expected YYYY-MM`);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${pad(lastDay)}`,
    from: monthStart(year, month),
    to: monthStart(nextYear, nextMonth),
  };
}

/** The `YYYY-MM` month an instant falls in, on the Amsterdam calendar. */
export function periodOf(instant: Date): string {
  const parts = monthFormat.formatToParts(instant);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/** The calendar month before the one `now` falls in (Amsterdam time). */
export function previousPeriod(now: Date): Period {
  const [year, month] = periodOf(now).split("-").map(Number) as [number, number];
  return month === 1
    ? periodFor(`${year - 1}-12`)
    : periodFor(`${year}-${pad(month - 1)}`);
}
