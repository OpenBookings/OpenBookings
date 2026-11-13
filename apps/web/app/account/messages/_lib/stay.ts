/**
 * Pure helpers for the guest inbox: where a stay stands relative to today,
 * and how consecutive messages group into runs. Dates are `YYYY-MM-DD`
 * strings; "today" is the property's local date (see GUEST_THREADS_SQL), so
 * the server and the browser agree and check-in day flips at the hotel's
 * midnight, not the guest's.
 */

type StayPhase = "upcoming" | "current" | "past";

export type StayStatus = {
  phase: StayPhase;
  /** "In 12 days", "Tomorrow", "Check-in today", "Staying now", "Check-out today", "Past stay". */
  label: string;
};

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return dayNumber(checkOut) - dayNumber(checkIn);
}

export function stayStatus(checkIn: string | null, checkOut: string | null, today: string): StayStatus | null {
  if (!checkIn || !checkOut) return null;
  const untilIn = dayNumber(checkIn) - dayNumber(today);
  const untilOut = dayNumber(checkOut) - dayNumber(today);

  if (untilIn > 1) return { phase: "upcoming", label: `In ${untilIn} days` };
  if (untilIn === 1) return { phase: "upcoming", label: "Tomorrow" };
  if (untilIn === 0) return { phase: "current", label: "Check-in today" };
  if (untilOut > 0) return { phase: "current", label: "Staying now" };
  if (untilOut === 0) return { phase: "current", label: "Check-out today" };
  return { phase: "past", label: "Past stay" };
}

const stayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayOfMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });

/** "13–15 Nov", or "28 Nov – 2 Dec" across months. */
export function stayRange(checkIn: string | null, checkOut: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${dayOfMonth.format(a)}–${stayFormatter.format(b)}`;
  }
  return `${stayFormatter.format(a)} – ${stayFormatter.format(b)}`;
}

/** Messages closer together than this, from the same side, share one run. */
const GROUP_GAP_MS = 5 * 60_000;

type Groupable = { sender_role: string; created_at: string };

/**
 * Where message `i` sits in its run of same-sender messages. A run breaks on
 * a change of sender, a gap over GROUP_GAP_MS, or a new calendar day (the day
 * divider sits between them anyway).
 */
export function runPosition(messages: Groupable[], i: number, dayOf: (iso: string) => string): { first: boolean; last: boolean } {
  const joins = (a: Groupable | undefined, b: Groupable | undefined) =>
    !!a &&
    !!b &&
    a.sender_role === b.sender_role &&
    Date.parse(b.created_at) - Date.parse(a.created_at) <= GROUP_GAP_MS &&
    dayOf(a.created_at) === dayOf(b.created_at);
  return { first: !joins(messages[i - 1], messages[i]), last: !joins(messages[i], messages[i + 1]) };
}

/** Prefill only; a tap never sends. Fixed for every property for now. */
export const STARTER_QUESTIONS = [
  "Can I check in early?",
  "Where can I park?",
  "I'll arrive late",
  "Is breakfast included?",
] as const;
