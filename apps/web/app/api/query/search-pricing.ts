import { resolveRoom, type ResolvedRoom, type RoomRow } from "@openbookings/pricing";
import { evenRoomParties } from "@/lib/booking/room-parties";

export type SearchStay = ResolvedRoom & {
  /** What all `rooms` rooms cost together, all-in, in cents. */
  total_price_cents: number;
  /** How many rooms of this type the card is priced for: the rooms searched. */
  rooms: number;
};

/**
 * Each hotel's cheapest stay for the whole search: `rooms` rooms of one room
 * type, each priced for its own share of the party (evenRoomParties, the
 * property page's split), cheapest total first. `total_price_cents` is what all
 * the rooms cost together, all-in; the other price fields (`room_price_cents`,
 * `tourist_tax`, `priced_nights`…) are the first room's.
 */
export function priceSearchStays(
  rows: RoomRow[],
  stay: { adults: number; children: number; infants: number; rooms: number; arrivalDate: string },
  today?: string,
): SearchStay[] {
  const parties = evenRoomParties(stay);
  const byHotel = new Map<string, SearchStay>();
  for (const row of rows) {
    const priced = parties.map((party) => resolveRoom(row, { ...party, arrivalDate: stay.arrivalDate }, today));
    const total = priced.reduce((sum, r) => sum + r.total_price_cents, 0);
    const existing = byHotel.get(row.hotel_id);
    if (!existing || total < existing.total_price_cents) {
      byHotel.set(row.hotel_id, { ...priced[0], total_price_cents: total, rooms: parties.length });
    }
  }
  return [...byHotel.values()].sort((a, b) => a.total_price_cents - b.total_price_cents);
}
