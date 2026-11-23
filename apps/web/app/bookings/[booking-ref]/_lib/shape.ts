import {
  allowedActions,
  checkInClosesAt,
  TIER_LABELS,
  type BookingStatus,
  type CancellationTier,
  type NightValue,
} from '@openbookings/pricing';
import { buildTimeline, formatWhen, type Timeline } from './timeline';
import { bookingReference } from '@openbookings/db/booking-reference';

/** One row of the guest booking query (load.ts). Timestamps arrive as ISO text. */
export type GuestBookingRow = {
  booking_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  property_name: string;
  city: string | null;
  timezone: string;
  check_in_time: string | null;
  check_in_until: string | null;
  check_out_time: string;
  confirmed_at: string | null;
  /** Refunded so far (rows that did not fail), euros. */
  refunded: number;
  rooms: {
    reservation_id: string;
    room_name: string;
    cancellation_tier: CancellationTier | null;
    check_in_at: string | null;
    full_refund_until: string | null;
    nights: NightValue[];
    cancelled_at: string | null;
    /** Under 2, no place taken. Absent on rows read before these columns were selected. */
    infants?: number;
    cots?: number;
    extra_beds?: number;
    /** Owed at the hotel for the cots and extra beds, euros. Postgres numeric arrives as text or number. */
    pay_at_property_amount?: number | string;
  }[];
};

type GuestBookingRoom = {
  reservationId: string;
  roomName: string;
  tierLabel: string;
  /** What cancelling this room would mean right now. */
  cancelHint: string;
  cancelledAt: string | null;
  paid: number;
  /** "1 cot · 1 extra bed · 1 infant", or null when there is none of these. */
  extras: string | null;
  /** Owed at the hotel for cots and extra beds, euros. */
  payAtProperty: number;
};

export type GuestBooking = {
  id: string;
  reference: string;
  propertyName: string;
  city: string | null;
  checkInDate: string;
  checkOutDate: string;
  status: BookingStatus;
  canCancel: boolean;
  totalPaid: number;
  /** Still to pay at the hotel for the cots and extra beds of rooms not cancelled, euros. */
  payAtProperty: number;
  refunded: number;
  rooms: GuestBookingRoom[];
  /** What cancelling the whole booking would mean right now. */
  cancelHint: string;
  timeline: Timeline;
};

const cents = (euros: number) => Math.round(euros * 100);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function extrasText(r: GuestBookingRow['rooms'][number]): string | null {
  const parts = [
    (r.cots ?? 0) > 0 && plural(r.cots ?? 0, 'cot', 'cots'),
    (r.extra_beds ?? 0) > 0 && plural(r.extra_beds ?? 0, 'extra bed', 'extra beds'),
    (r.infants ?? 0) > 0 && plural(r.infants ?? 0, 'infant', 'infants'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function toGuestBooking(row: GuestBookingRow, now: Date): GuestBooking {
  const snapshotted = row.rooms.length > 0 && row.rooms.every((r) => r.cancellation_tier && r.check_in_at);
  const rooms = row.rooms.map((r): GuestBookingRoom => {
    const tier = r.cancellation_tier ?? 'standard';
    const freeUntil = tier === 'non_refundable' || !r.full_refund_until ? null : new Date(r.full_refund_until);
    return {
      reservationId: r.reservation_id,
      roomName: r.room_name,
      tierLabel: TIER_LABELS[tier],
      cancelHint:
        freeUntil && freeUntil.getTime() >= now.getTime()
          ? `Full refund until ${formatWhen(freeUntil, row.timezone)}.`
          : "The room price isn't refunded. Tourist tax is.",
      cancelledAt: r.cancelled_at,
      paid: r.nights.reduce((sum, n) => sum + cents(n.price) + cents(n.touristTax), 0) / 100,
      extras: extrasText(r),
      payAtProperty: Number(r.pay_at_property_amount ?? 0) || 0,
    };
  });

  const canCancel =
    snapshotted &&
    allowedActions({
      status: row.status,
      checkInAt: new Date(row.rooms[0].check_in_at as string),
      checkInClosesAt: checkInClosesAt({
        arrivalDate: row.check_in_date,
        checkInTime: row.check_in_time,
        checkInUntil: row.check_in_until,
        timeZone: row.timezone,
      }),
      checkOutDate: row.check_out_date,
      timeZone: row.timezone,
      now,
      actor: 'guest',
    }).includes('cancel');

  return {
    id: row.booking_id,
    reference: bookingReference(row.booking_id),
    propertyName: row.property_name,
    city: row.city,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    status: row.status,
    canCancel,
    totalPaid: rooms.reduce((sum, r) => sum + cents(r.paid), 0) / 100,
    payAtProperty: rooms.filter((r) => !r.cancelledAt).reduce((sum, r) => sum + cents(r.payAtProperty), 0) / 100,
    refunded: Number(row.refunded),
    rooms,
    cancelHint: bookingCancelHint(rooms),
    timeline: buildTimeline(row, now),
  };
}

function bookingCancelHint(rooms: GuestBookingRoom[]): string {
  const hints = new Set(rooms.filter((r) => !r.cancelledAt).map((r) => r.cancelHint));
  return hints.size === 1 ? [...hints][0] : 'The refund differs per room.';
}
