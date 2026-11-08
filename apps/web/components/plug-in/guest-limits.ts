import { MAX_ADULTS, MAX_CHILDREN, MAX_ROOMS } from "@/lib/booking/stay-input";

export type Guests = { adults: number; children: number; rooms: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)));

/**
 * The party search and the stay quote accept (see parseStayInput): at least
 * one adult, and no more rooms than adults or than one booking can hold.
 * Lowering adults below the rooms takes rooms down with it.
 */
export function clampGuests(g: Guests): Guests {
  const adults = clamp(g.adults, 1, MAX_ADULTS);
  return {
    adults,
    children: clamp(g.children, 0, MAX_CHILDREN),
    rooms: clamp(g.rooms, 1, Math.min(MAX_ROOMS, adults)),
  };
}
