import {
  allowedActions,
  checkInClosesAt,
  describePolicy,
  POLICY_VERSION,
  TIER_LABELS,
  type BookingStatus,
  type CancellationTier,
  type NightValue,
} from '@openbookings/pricing';

/** One row of the guest booking query (load.ts). Timestamps arrive as ISO text. */
export type GuestBookingRow = {
  booking_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  property_name: string;
  city: string | null;
  timezone: string;
  check_in_until: string | null;
  confirmed_at: string | null;
  /** Refunded so far (rows that did not fail), euros. */
  refunded: number;
  rooms: {
    reservation_id: string;
    room_name: string;
    cancellation_tier: CancellationTier | null;
    check_in_at: string | null;
    grace_until: string | null;
    full_refund_until: string | null;
    partial_refund_until: string | null;
    nights: NightValue[];
    cancelled_at: string | null;
  }[];
};

export type GuestBookingRoom = {
  reservationId: string;
  roomName: string;
  tierLabel: string;
  policyLines: string[];
  cancelledAt: string | null;
  paid: number;
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
  refunded: number;
  rooms: GuestBookingRoom[];
};

const cents = (euros: number) => Math.round(euros * 100);
const date = (v: string | null) => (v === null ? null : new Date(v));

export function toGuestBooking(row: GuestBookingRow, now: Date): GuestBooking {
  const snapshotted = row.rooms.length > 0 && row.rooms.every((r) => r.cancellation_tier && r.check_in_at);
  const rooms = row.rooms.map((r): GuestBookingRoom => {
    const tier = r.cancellation_tier ?? 'standard';
    const checkInAt = date(r.check_in_at);
    return {
      reservationId: r.reservation_id,
      roomName: r.room_name,
      tierLabel: TIER_LABELS[tier],
      policyLines: checkInAt
        ? describePolicy(
            {
              tier,
              confirmedAt: date(row.confirmed_at) ?? checkInAt,
              checkInAt,
              graceUntil: date(r.grace_until),
              fullRefundUntil: date(r.full_refund_until),
              partialRefundUntil: date(r.partial_refund_until),
              policyVersion: POLICY_VERSION,
            },
            row.timezone,
            now,
          )
        : [],
      cancelledAt: r.cancelled_at,
      paid: r.nights.reduce((sum, n) => sum + cents(n.price) + cents(n.touristTax), 0) / 100,
    };
  });

  const canCancel =
    snapshotted &&
    allowedActions({
      status: row.status,
      checkInAt: new Date(row.rooms[0].check_in_at as string),
      checkInClosesAt: checkInClosesAt({
        arrivalDate: row.check_in_date,
        checkInUntil: row.check_in_until,
        timeZone: row.timezone,
      }),
      checkOutDate: row.check_out_date,
      timeZone: row.timezone,
      now,
    }).includes('cancel');

  return {
    id: row.booking_id,
    reference: row.booking_id.slice(0, 8).toUpperCase(),
    propertyName: row.property_name,
    city: row.city,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    status: row.status,
    canCancel,
    totalPaid: rooms.reduce((sum, r) => sum + cents(r.paid), 0) / 100,
    refunded: Number(row.refunded),
    rooms,
  };
}
