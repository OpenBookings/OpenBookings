import {
  allowedActions,
  checkInClosesAt,
  describePolicy,
  POLICY_VERSION,
  TIER_LABELS,
  type BookingAction,
  type BookingStatus,
  type CancellationTier,
  type NightValue,
} from "@openbookings/pricing";
import { roomPaid } from "@openbookings/db/booking-lifecycle";
import type { ReservationStatus, ReservationSummary } from "@/components/dashboard/reservation-types";

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

/** The guest's contact details as the guest_profile row stores them (0028). */
export type GuestContactRow = {
  guest_phone: string | null;
  guest_address: {
    line1: string;
    line2: string | null;
    postal_code: string;
    city: string;
    country: string;
  } | null;
};

/**
 * Contact details the guest chose to share. Not part of HostReservation on
 * purpose: they leave the server only when a member breaks the glass on one
 * booking (./break-glass.ts), and that is logged.
 */
export type GuestContact = {
  phone: string | null;
  /** Display lines, country spelled out. */
  address: string[] | null;
};

export function toGuestContact(row: GuestContactRow): GuestContact {
  return { phone: row.guest_phone, address: addressLines(row.guest_address) };
}

function addressLines(address: GuestContactRow["guest_address"]): string[] | null {
  if (!address) return null;
  const country = address.country.trim();
  return [
    address.line1,
    address.line2,
    `${address.postal_code} ${address.city}`,
    regionNames.of(country) ?? country,
  ].filter((line): line is string => !!line);
}

/** One row of the host reservations query (query.ts). Timestamps arrive as ISO text. */
export type HostReservationRow = {
  booking_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  guest_name: string | null;
  guests: number;
  total_amount: number;
  timezone: string;
  check_in_time: string | null;
  check_in_until: string | null;
  check_out_time: string | null;
  departed_early_on: string | null;
  confirmed_at: string | null;
  /** Refunded so far on the booking (rows that did not fail), euros. */
  refunded: number;
  /** Refund rows still pending or failed: money the guest is owed but hasn't had. */
  unsettled_refunds: number;
  rooms: {
    reservation_id: string;
    room_name: string;
    cancellation_tier: CancellationTier | null;
    check_in_at: string | null;
    full_refund_until: string | null;
    nights: NightValue[];
    cancelled_at: string | null;
  }[];
};

export type HostReservationRoom = {
  reservationId: string;
  roomName: string;
  tierLabel: string;
  policyLines: string[];
  cancelledAt: string | null;
  /** What the guest paid for this room, tourist tax included. */
  paid: number;
  /** Nights of the stay, for picking the last night stayed. */
  nights: string[];
};

export type HostReservation = ReservationSummary & {
  timezone: string;
  /** The property's check-in and check-out times ("15:00"), when it states them. */
  checkInTime: string | null;
  checkOutTime: string | null;
  refundedAmount: number;
  refundIssue: boolean;
  departedEarlyOn: string | null;
  rooms: HostReservationRoom[];
  actions: BookingAction[];
  /** Whether the viewer may retry a refund that didn't go through. */
  canRetryRefunds: boolean;
};

const DISPLAY_STATUS: Record<BookingStatus, ReservationStatus> = {
  pending: "pending",
  confirmed: "confirmed",
  checked_in: "checked_in",
  completed: "checked_out",
  cancelled: "cancelled",
  no_show: "no_show",
};

const date = (v: string | null) => (v === null ? null : new Date(v));

export function toHostReservation(row: HostReservationRow, now: Date): HostReservation {
  const snapshotted = row.rooms.length > 0 && row.rooms.every((r) => r.cancellation_tier && r.check_in_at);
  const rooms = row.rooms.map((r): HostReservationRoom => {
    const tier = r.cancellation_tier ?? "standard";
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
              fullRefundUntil: date(r.full_refund_until),
              policyVersion: POLICY_VERSION,
            },
            row.timezone,
            now,
          )
        : [],
      cancelledAt: r.cancelled_at,
      paid: roomPaid(r),
      nights: r.nights.map((n) => n.date),
    };
  });

  const actions = snapshotted
    ? allowedActions({
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
      }).filter((a) => !(a === "record_early_departure" && row.departed_early_on))
    : [];

  const names = [...new Set(rooms.map((r) => r.roomName))];
  return {
    id: row.booking_id,
    reference: row.booking_id.slice(0, 8).toUpperCase(),
    guestName: row.guest_name ?? "Guest",
    roomName: names.join(" + "),
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    guests: row.guests,
    status: DISPLAY_STATUS[row.status],
    totalAmount: snapshotted
      ? rooms.reduce((sum, r) => sum + Math.round(r.paid * 100), 0) / 100
      : Number(row.total_amount),
    timezone: row.timezone,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    refundedAmount: Number(row.refunded),
    refundIssue: Number(row.unsettled_refunds) > 0,
    departedEarlyOn: row.departed_early_on,
    rooms,
    actions,
    // Narrowed to the viewer's role by loadHostReservations.
    canRetryRefunds: false,
  };
}
