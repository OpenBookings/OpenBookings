import { roomReasons, type PropertyAvailability, type RoomAvailability } from "@openbookings/db";
import { offeredRates, resolveRoom, type RoomRow, type UnavailableReason } from "@openbookings/pricing";

/** What a search result says about booking the searched stay. */
export type SearchAvailability = { bookable: boolean; reason: UnavailableReason | null };

/**
 * The rate rows a guest could be offered for this stay, judged as the
 * property page judges them (`offeredRates`, Annex B B.4): a Non-refundable
 * rate next to an open refundable rate on its room must be at least 10%
 * cheaper on the stay's room price for one room's share of the party.
 */
export function offeredSearchRates<R extends RoomRow>(
  rows: R[],
  rooms: { room: RoomAvailability }[],
  party: { adults: number; children: number; infants?: number },
  arrivalDate: string,
): R[] {
  const byId = new Map(rooms.map(({ room }) => [room.roomId, room]));
  return offeredRates(rows, (row) => ({
    roomId: row.room_id,
    isRefundable: row.is_refundable,
    open: byId.get(row.room_id)?.ratePlans.some((p) => p.ratePlanId === row.rate_plan_id && p.reasons.length === 0) ?? false,
    priceCents: resolveRoom(row, { ...party, arrivalDate }).room_price_cents,
  }));
}

/**
 * The rows that may price each hotel's card. At a bookable hotel, a rate
 * prices it only when its room takes one room's share of the party and the
 * rate is open for these dates; the card then shows the cheapest of them. An
 * unbookable hotel, shown only in testing mode, is priced from all its rates:
 * the card still needs a price.
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
