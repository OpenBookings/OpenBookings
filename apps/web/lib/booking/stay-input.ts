import { stayBoundErrors } from "@/app/api/query/search-bounds";

/**
 * The stay a guest asks about: dates and party, as search and the stay quote
 * read them from the URL (`checkin`, `checkout`, `adults`, `children`,
 * `rooms`). Dates stay YYYY-MM-DD strings.
 */
export type StayInput = { checkIn: string; checkOut: string; adults: number; children: number; rooms: number };

/** Booking intents take 1–9 rooms; a quote for more could never be booked. */
export const MAX_ROOMS = 9;
export const MAX_ADULTS = 30;
export const MAX_CHILDREN = 20;

/** Today's calendar date in `timeZone`, as YYYY-MM-DD. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

function read(p: URLSearchParams | Record<string, unknown>, key: string): string | null {
  const v = p instanceof URLSearchParams ? p.get(key) : p[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function count(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/**
 * Validates a stay before anything reaches SQL. `todayInZone` is today where
 * the stay happens (the property's zone; search, which has no single property,
 * uses Atlantic/Azores, the EU's earliest today): a check-in before it is refused.
 */
export function parseStayInput(
  p: URLSearchParams | Record<string, unknown>,
  todayInZone: string,
): { ok: true; value: StayInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const checkIn = read(p, "checkin");
  const checkOut = read(p, "checkout");
  if (checkIn === null) errors.push("checkin is required");
  if (checkOut === null) errors.push("checkout is required");
  if (checkIn !== null && checkOut !== null) {
    const bounds = stayBoundErrors({ checkin: checkIn, checkout: checkOut });
    errors.push(...bounds);
    // Both are real YYYY-MM-DD dates here, so string order is date order.
    if (bounds.length === 0 && checkIn < todayInZone) errors.push("checkin cannot be in the past");
  }

  const adults = count(read(p, "adults"), 1, MAX_ADULTS);
  const children = read(p, "children") === null ? 0 : count(read(p, "children"), 0, MAX_CHILDREN);
  const rooms = count(read(p, "rooms"), 1, MAX_ROOMS);
  if (adults === null) errors.push(`adults must be a whole number from 1 to ${MAX_ADULTS}`);
  if (children === null) errors.push(`children must be a whole number from 0 to ${MAX_CHILDREN}`);
  if (rooms === null) errors.push(`rooms must be a whole number from 1 to ${MAX_ROOMS}`);
  if (adults !== null && rooms !== null && rooms > adults) errors.push("every room needs an adult");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      checkIn: checkIn as string,
      checkOut: checkOut as string,
      adults: adults as number,
      children: children as number,
      rooms: rooms as number,
    },
  };
}
