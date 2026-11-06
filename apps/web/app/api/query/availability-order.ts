import { roomReasons, type PropertyAvailability, type RoomAvailability } from "@openbookings/db";
import type { UnavailableReason } from "@openbookings/pricing";

/** What a search result says about booking the searched stay. */
export type SearchAvailability = { bookable: boolean; reason: UnavailableReason | null };

/**
 * The rows that may price each hotel's card. At a bookable hotel, a room
 * prices it only when it takes one room's share of the party and its rate
 * (the one the search query picked for it) is open for these dates. An
 * unbookable hotel, shown only in testing mode, is priced from its cheapest
 * room, and so is a bookable one whose open rates all lost to the query's
 * pick: the card still needs a price.
 */
export function priceCandidates<R extends { hotel_id: string; room_id: string; rate_plan_id: string }>(
  rows: R[],
  rooms: { room: RoomAvailability }[],
  availability: Map<string, PropertyAvailability>,
  party: { adults: number; children: number },
): R[] {
  const byId = new Map(rooms.map(({ room }) => [room.roomId, room]));
  const qualifies = (row: R) => {
    const room = byId.get(row.room_id);
    if (!room || roomReasons(room, party).length > 0) return false;
    return room.ratePlans.some((p) => p.ratePlanId === row.rate_plan_id && p.reasons.length === 0);
  };

  const byHotel = new Map<string, R[]>();
  for (const row of rows) byHotel.set(row.hotel_id, [...(byHotel.get(row.hotel_id) ?? []), row]);

  return [...byHotel].flatMap(([hotelId, hotelRows]) => {
    if (!availability.get(hotelId)?.bookable) return hotelRows;
    const open = hotelRows.filter(qualifies);
    return open.length > 0 ? open : hotelRows;
  });
}

/**
 * Hotels that cannot take the stay are left out of search. In testing mode
 * they are kept, after every bookable hotel and with their reason, so each
 * demo case is one click away. Order within each group is kept.
 */
export function orderByAvailability<T extends { availability: SearchAvailability }>(
  results: T[],
  o: { testing: boolean },
): T[] {
  const bookable = results.filter((r) => r.availability.bookable);
  if (!o.testing) return bookable;
  return [...bookable, ...results.filter((r) => !r.availability.bookable)];
}
