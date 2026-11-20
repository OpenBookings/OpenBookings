import { MAX_ADULTS, MAX_CHILDREN, MAX_INFANTS_PER_ROOM, MAX_ROOMS } from "@/lib/booking/stay-input";

/** Adults 13+, children 2–12, infants under 2: the same bands at every hotel. */
export type Guests = { adults: number; children: number; infants: number; rooms: number };

/** What each band means, for every place guests are counted. */
export { AGE_BANDS } from "@openbookings/pricing";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)));

/** How many one unit of a room type sleeps, and, when known, how many units are left. */
export type RoomCapacity = { maxAdults: number; maxChildren: number; unitsLeft?: number };

/**
 * The fewest rooms, from the number asked for up, that the party fits in at
 * this hotel, or null when no number does. The party is split evenly over
 * the rooms, rounded up (perRoomParty, as the stay quote and search do), and
 * fits when a room type takes that share and enough units are left. Every
 * room needs an adult, so there are never more rooms than adults.
 */
export function fewestRoomsThatFit(
  party: { adults: number; children: number; rooms: number },
  capacities: RoomCapacity[],
): number | null {
  const most = Math.min(MAX_ROOMS, party.adults);
  for (let rooms = Math.max(1, party.rooms); rooms <= most; rooms++) {
    const adults = Math.ceil(party.adults / rooms);
    const children = Math.ceil(party.children / rooms);
    const fitting = capacities.filter((c) => adults <= c.maxAdults && children <= c.maxChildren);
    const units = fitting.reduce((n, c) => n + (c.unitsLeft ?? Infinity), 0);
    if (fitting.length > 0 && units >= rooms) return rooms;
  }
  return null;
}

/**
 * The party search and the stay quote accept (see parseStayInput): at least
 * one adult, no more rooms than adults or than one booking can hold, and at
 * most MAX_INFANTS_PER_ROOM infants a room. Lowering adults below the rooms
 * takes rooms down with it, and fewer rooms take infants down. An
 * adults-only property takes no children or infants.
 *
 * With a hotel's `roomCapacities` (its property page), rooms also go up to
 * the fewest the party fits in there, so the picker never asks for a party
 * no room can take. When no number of rooms fits, rooms are left alone and
 * the page says so.
 */
export function clampGuests(
  g: Guests,
  opts: { childrenWelcome?: boolean; roomCapacities?: RoomCapacity[] } = {},
): Guests {
  const adults = clamp(g.adults, 1, MAX_ADULTS);
  const kids = opts.childrenWelcome ?? true;
  const children = kids ? clamp(g.children, 0, MAX_CHILDREN) : 0;
  let rooms = clamp(g.rooms, 1, Math.min(MAX_ROOMS, adults));
  if (opts.roomCapacities?.length) {
    rooms = fewestRoomsThatFit({ adults, children, rooms }, opts.roomCapacities) ?? rooms;
  }
  return {
    adults,
    children,
    infants: kids ? clamp(g.infants, 0, MAX_INFANTS_PER_ROOM * rooms) : 0,
    rooms,
  };
}
