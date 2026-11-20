import { resolveRoom, type ResolvedRoom, type RoomRow } from "@openbookings/pricing";
import { evenRoomParties } from "@/lib/booking/room-parties";

export type SearchStay = ResolvedRoom & {
  /** How many rooms of this type the card is priced for: the rooms searched. */
  rooms: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each hotel's cheapest stay for the whole search: `rooms` rooms of one room
 * type, each priced for its own share of the party (evenRoomParties, the
 * property page's split), cheapest total first. `total_price` is what all
 * the rooms cost together, all-in; the other price fields (`room_price`,
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
    const total = round2(priced.reduce((sum, r) => sum + r.total_price, 0));
    const existing = byHotel.get(row.hotel_id);
    if (!existing || total < existing.total_price) {
      byHotel.set(row.hotel_id, { ...priced[0], total_price: total, rooms: parties.length });
    }
  }
  return [...byHotel.values()].sort((a, b) => a.total_price - b.total_price);
}
