/**
 * Live facts for one hotel and one date window. Server-side only (it reads the
 * database); the hotel id comes from the caller, which takes it from the session.
 * Hotel level: no guest columns are selected. SQL here, mapping in facts-map.ts.
 */
import { query, queryOne } from "@openbookings/db";
import {
  mapBookings,
  mapInventory,
  type BookingMoneyRow,
  type CapacityRow,
  type InventoryOverrideRow,
  type ReservationRow,
} from "./facts-map";
import type { DateRange } from "./period";
import type { Facts, IsoDate } from "./types";

const AMS = "Europe/Amsterdam";

interface ReservationSql {
  reservation_id: string;
  booking_id: string;
  sort_index: string | number;
  booking_status: ReservationRow["bookingStatus"];
  booked_at: Date | string;
  check_in: IsoDate;
  check_out: IsoDate;
  total_nights: number;
  departed_early_on: IsoDate | null;
  reservation_cancelled_at: Date | string | null;
  booking_cancelled_at: Date | string | null;
  room_id: string;
  rate_plan_id: string;
  price_per_night: string | number;
  nights: ReservationRow["nightsJson"] | null;
  vat_split: ReservationRow["vatSplit"];
}

const iso = (v: Date | string): string => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : iso(v));

export async function loadWindowFacts(propertyId: string, window: DateRange): Promise<Facts> {
  const [reservationRows, rooms, ratePlans] = await Promise.all([
    query<ReservationSql>(
      `SELECT * FROM (
         SELECT r.id AS reservation_id, r.booking_id,
                (row_number() OVER (PARTITION BY r.booking_id ORDER BY r.created_at, r.id) - 1) AS sort_index,
                b.status::text AS booking_status,
                coalesce(b.confirmed_at, b.created_at) AS booked_at,
                b.check_in_date::text AS check_in, b.check_out_date::text AS check_out,
                r.total_nights, b.departed_early_on::text AS departed_early_on,
                r.cancelled_at AS reservation_cancelled_at, b.cancelled_at AS booking_cancelled_at,
                r.room_id, r.rate_plan_id, r.price_per_night, r.nights, r.vat_split
           FROM reservations r
           JOIN bookings b ON b.id = r.booking_id
          WHERE b.hotel_id = $1 AND b.status <> 'pending'
       ) x
       WHERE (x.booked_at AT TIME ZONE '${AMS}')::date BETWEEN $2::date AND $3::date
          OR (x.check_in::date <= $3::date AND x.check_out::date > $2::date)`,
      [propertyId, window.from, window.to],
    ),
    query<{ id: string; name: string; total_units: number; created_on: IsoDate; archived_on: IsoDate | null }>(
      `SELECT id, name, total_units,
              (created_at AT TIME ZONE '${AMS}')::date::text AS created_on,
              (archived_at AT TIME ZONE '${AMS}')::date::text AS archived_on
         FROM rooms WHERE property_id = $1`,
      [propertyId],
    ),
    query<{ id: string; name: string }>(
      `SELECT rp.id, rp.name FROM rate_plans rp JOIN rooms ro ON ro.id = rp.room_id WHERE ro.property_id = $1`,
      [propertyId],
    ),
  ]);

  const bookingIds = [...new Set(reservationRows.map((r) => r.booking_id))];
  const [intentRooms, refundRows, commissionRows, overrideRows] = await Promise.all([
    bookingIds.length === 0
      ? Promise.resolve([] as { booking_id: string; room_id: string; rate_plan_id: string; sort_order: number; discount: string | null }[])
      : query<{ booking_id: string; room_id: string; rate_plan_id: string; sort_order: number; discount: string | null }>(
          `SELECT bi.booking_id, ir.room_id, ir.rate_plan_id, ir.sort_order, ir.discount_amount::text AS discount
             FROM booking_intent_rooms ir JOIN booking_intents bi ON bi.id = ir.intent_id
            WHERE bi.booking_id = ANY($1::uuid[])
            ORDER BY bi.booking_id, ir.sort_order`,
          [bookingIds],
        ),
    bookingIds.length === 0
      ? Promise.resolve([] as { booking_id: string; reservation_id: string | null; cents: string }[])
      : query<{ booking_id: string; reservation_id: string | null; cents: string }>(
          `SELECT booking_id, reservation_id, round(accommodation_amount * 100)::text AS cents
             FROM refunds WHERE booking_id = ANY($1::uuid[]) AND status = 'succeeded'`,
          [bookingIds],
        ),
    bookingIds.length === 0
      ? Promise.resolve([] as { booking_id: string; commission_cents: string; refunded: string }[])
      : query<{ booking_id: string; commission_cents: string; refunded: string }>(
          `SELECT b.id AS booking_id, b.commission_cents::text,
                  -- fee_refund rows hold a negative amount; commissionRefundedCents is positive
                  coalesce((SELECT -sum(ce.gross_amount) FROM commission_entries ce
                             WHERE ce.booking_id = b.id AND ce.kind = 'fee_refund'), 0)::text AS refunded
             FROM bookings b WHERE b.id = ANY($1::uuid[])`,
          [bookingIds],
        ),
    query<{ room_id: string; date: IsoDate; total_rooms: number | null; available_override: number | null; blocked_rooms: number | null }>(
      `SELECT ri.room_id, ri.date::text AS date, ri.total_rooms, ri.available_override, ri.blocked_rooms
         FROM room_inventory ri JOIN rooms ro ON ro.id = ri.room_id
        WHERE ro.property_id = $1 AND ri.date BETWEEN $2::date AND $3::date`,
      [propertyId, window.from, window.to],
    ),
  ]);

  const rows = toReservationRows(reservationRows, intentRooms);
  const money: BookingMoneyRow[] = commissionRows.map((c) => ({
    bookingId: c.booking_id,
    commissionCents: Number(c.commission_cents),
    commissionRefundedCents: Number(c.refunded),
    accommodationRefunds: refundRows
      .filter((f) => f.booking_id === c.booking_id)
      .map((f) => ({ reservationId: f.reservation_id, cents: Number(f.cents) })),
  }));

  const mapped = mapBookings(rows, money);
  const capacity: CapacityRow[] = rooms.map((r) => ({
    roomId: r.id,
    totalUnits: r.total_units,
    createdOn: r.created_on,
    archivedOn: r.archived_on,
  }));
  const overrides: InventoryOverrideRow[] = overrideRows.map((o) => ({
    roomId: o.room_id,
    date: o.date,
    totalRooms: o.total_rooms,
    availableOverride: o.available_override,
    blockedRooms: o.blocked_rooms ?? 0,
  }));

  return {
    bookings: mapped.bookings,
    nights: mapped.nights.filter((n) => n.date >= window.from && n.date <= window.to),
    inventory: mapInventory(window, capacity, overrides),
    roomTypeNames: Object.fromEntries(rooms.map((r) => [r.id, r.name])),
    ratePlanNames: Object.fromEntries(ratePlans.map((p) => [p.id, p.name])),
  };
}

function toReservationRows(
  rows: ReservationSql[],
  intentRooms: { booking_id: string; room_id: string; rate_plan_id: string; sort_order: number; discount: string | null }[],
): ReservationRow[] {
  // Discount: pair intent rooms with reservations of the same (booking, room, rate plan),
  // in order. Only a 1:1 match gets a discount; anything else is unknown (null).
  const intentByKey = new Map<string, { sort_order: number; discount: string | null }[]>();
  for (const ir of intentRooms) {
    const key = `${ir.booking_id}|${ir.room_id}|${ir.rate_plan_id}`;
    const list = intentByKey.get(key) ?? [];
    list.push(ir);
    intentByKey.set(key, list);
  }
  const resByKey = new Map<string, ReservationSql[]>();
  for (const r of rows) {
    const key = `${r.booking_id}|${r.room_id}|${r.rate_plan_id}`;
    const list = resByKey.get(key) ?? [];
    list.push(r);
    resByKey.set(key, list);
  }
  const discountOf = (r: ReservationSql): number | null => {
    const key = `${r.booking_id}|${r.room_id}|${r.rate_plan_id}`;
    const intents = (intentByKey.get(key) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    const group = (resByKey.get(key) ?? []).slice().sort((a, b) => Number(a.sort_index) - Number(b.sort_index));
    if (intents.length === 0 || intents.length !== group.length) return null;
    const paired = intents[group.indexOf(r)];
    return paired?.discount == null ? null : Number(paired.discount);
  };

  return rows.map((r) => {
    const nightsJson = (r.nights ?? []).map((n) => ({ date: n.date, price: Number(n.price) }));
    const pricePerNight = Number(r.price_per_night);
    const roomsTotalCents =
      nightsJson.length > 0
        ? nightsJson.reduce((a, n) => a + Math.round(n.price * 100), 0)
        : Math.round(pricePerNight * 100) * r.total_nights;
    return {
      reservationId: r.reservation_id,
      bookingId: r.booking_id,
      sortIndex: Number(r.sort_index),
      bookingStatus: r.booking_status,
      bookedAt: iso(r.booked_at),
      checkIn: r.check_in,
      checkOut: r.check_out,
      totalNights: r.total_nights,
      departedEarlyOn: r.departed_early_on,
      reservationCancelledAt: isoOrNull(r.reservation_cancelled_at),
      bookingCancelledAt: isoOrNull(r.booking_cancelled_at),
      roomId: r.room_id,
      ratePlanId: r.rate_plan_id,
      pricePerNight,
      nightsJson,
      vatSplit: r.vat_split ?? null,
      discountAmount: discountOf(r),
      roomsTotalCents,
    };
  });
}

/** Earliest Amsterdam booking date and whether the hotel has any booking at all (pending ignored). */
export async function loadHotelSpan(propertyId: string): Promise<{ earliest: IsoDate | null; hasAnyBookings: boolean }> {
  const row = await queryOne<{ earliest: IsoDate | null; n: string }>(
    `SELECT min((coalesce(confirmed_at, created_at) AT TIME ZONE '${AMS}')::date)::text AS earliest, count(*)::text AS n
       FROM bookings WHERE hotel_id = $1 AND status <> 'pending'`,
    [propertyId],
  );
  return { earliest: row?.earliest ?? null, hasAnyBookings: Number(row?.n ?? 0) > 0 };
}
