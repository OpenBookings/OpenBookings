/**
 * The panel's response-time line, from the Chatwoot inbox's working hours.
 * Hours are defined in the inbox's timezone; the line is written in the
 * host's (the browser's) timezone. Pure, so it runs on either side.
 */

export type WorkingHoursDay = {
  day_of_week: number;
  closed_all_day: boolean;
  open_all_day: boolean;
  open_hour: number | null;
  open_minutes: number | null;
  close_hour: number | null;
  close_minutes: number | null;
};

export type InboxHours = { timezone: string; workingHours: WorkingHoursDay[] };

type LocalParts = { year: number; month: number; day: number; weekday: number; minutes: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(instant: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
function zonedInstant(year: number, month: number, day: number, minutes: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let instant = wall;
  // Two passes settle DST transitions.
  for (let i = 0; i < 2; i++) {
    const p = localParts(instant, timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes);
    instant += wall - seen;
  }
  return instant;
}

function openSpan(day: WorkingHoursDay | undefined): [number, number] | null {
  if (!day || day.closed_all_day) return null;
  if (day.open_all_day) return [0, 24 * 60];
  if (day.open_hour === null || day.close_hour === null) return null;
  const open = day.open_hour * 60 + (day.open_minutes ?? 0);
  const close = day.close_hour * 60 + (day.close_minutes ?? 0);
  return close > open ? [open, close] : null;
}

export type Availability =
  | { kind: "always" }
  | { kind: "open"; until: Date }
  | { kind: "closed"; opensAt: Date }
  | { kind: "never" };

/** Whether people are working now, and until or from when. */
export function availability(hours: InboxHours, now: Date = new Date()): Availability {
  if (hours.workingHours.length === 0) return { kind: "always" };
  const tz = isValidTimeZone(hours.timezone) ? hours.timezone : "UTC";
  const byDay = new Map(hours.workingHours.map((d) => [d.day_of_week, d]));

  for (let offset = 0; offset <= 7; offset++) {
    const probe = localParts(now.getTime() + offset * 86_400_000, tz);
    const span = openSpan(byDay.get(probe.weekday));
    if (!span) continue;
    const opens = zonedInstant(probe.year, probe.month, probe.day, span[0], tz);
    const closes = zonedInstant(probe.year, probe.month, probe.day, span[1], tz);
    if (now.getTime() < opens) return { kind: "closed", opensAt: new Date(opens) };
    if (now.getTime() < closes) return { kind: "open", until: new Date(closes) };
  }
  return { kind: "never" };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "09:00", "tomorrow 09:00" or "Monday 09:00", in the viewer's timezone. */
export function formatOpening(at: Date, now: Date = new Date(), timeZone?: string): string {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  if (dayKey(at) === dayKey(now)) return time;
  if (dayKey(at) === dayKey(new Date(now.getTime() + 86_400_000))) return `tomorrow ${time}`;
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(at);
  return `${weekday} ${time}`;
}

/**
 * The honest line under the intake and while waiting for a person. Never a
 * promise of minutes: just whether the team is in, and when they are next.
 */
export function responseLine(hours: InboxHours | null, now: Date = new Date(), timeZone?: string): string {
  if (!hours) return "The support team replies during working hours.";
  const state = availability(hours, now);
  switch (state.kind) {
    case "always":
      return "The support team usually replies within a few hours.";
    case "open":
      return `The support team is in until ${formatOpening(state.until, now, timeZone)}.`;
    case "closed":
      return `A person replies from ${formatOpening(state.opensAt, now, timeZone)}.`;
    case "never":
      return "The support team replies during working hours.";
  }
}

/** The short estimate after "Waiting for the support team · usually …". */
export function waitEstimate(hours: InboxHours | null, now: Date = new Date(), timeZone?: string): string {
  if (!hours) return "during working hours";
  const state = availability(hours, now);
  if (state.kind === "closed") return `from ${formatOpening(state.opensAt, now, timeZone)}`;
  if (state.kind === "open" || state.kind === "always") return "within a few hours";
  return "during working hours";
}
