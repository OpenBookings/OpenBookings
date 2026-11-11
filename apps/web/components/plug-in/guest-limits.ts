import { MAX_ADULTS, MAX_CHILDREN, MAX_INFANTS_PER_ROOM, MAX_ROOMS } from "@/lib/booking/stay-input";

/** Adults 13+, children 2–12, infants under 2: the same bands at every hotel. */
export type Guests = { adults: number; children: number; infants: number; rooms: number };

/** What each band means, for every place guests are counted. */
export const AGE_BANDS = {
  adults: "Ages 13 or above",
  children: "Ages 2–12",
  infants: "Under 2",
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)));

/**
 * The party search and the stay quote accept (see parseStayInput): at least
 * one adult, no more rooms than adults or than one booking can hold, and at
 * most MAX_INFANTS_PER_ROOM infants a room. Lowering adults below the rooms
 * takes rooms down with it, and fewer rooms take infants down. An
 * adults-only property takes no children or infants.
 */
export function clampGuests(g: Guests, opts: { childrenWelcome?: boolean } = {}): Guests {
  const adults = clamp(g.adults, 1, MAX_ADULTS);
  const rooms = clamp(g.rooms, 1, Math.min(MAX_ROOMS, adults));
  const kids = opts.childrenWelcome ?? true;
  return {
    adults,
    children: kids ? clamp(g.children, 0, MAX_CHILDREN) : 0,
    infants: kids ? clamp(g.infants, 0, MAX_INFANTS_PER_ROOM * rooms) : 0,
    rooms,
  };
}
