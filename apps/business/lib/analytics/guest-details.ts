/**
 * Guest fields for the Guests page: live, bounded, never cached. Only
 * bookings made in the guest window (Booking Time, Amsterdam date, the last
 * 24 months up to today) are read, so the limit is a real limit on how far
 * back guest data is touched. Server-side only; the hotel id comes from the
 * caller, which takes it from the session. This module must never feed the
 * month cache.
 */
import { query } from "@openbookings/db";
import type { DateRange } from "./period";
import { shiftYears } from "./period";
import type { Facts, IsoDate } from "./types";

const AMS = "Europe/Amsterdam";

export const GUEST_WINDOW_YEARS = 2;

/** The booking dates guest details are read for. */
export function guestWindow(today: IsoDate): DateRange {
  return { from: shiftYears(today, -GUEST_WINDOW_YEARS), to: today };
}

export interface GuestDetail {
  reservationId: string;
  guestKey: string;
  guestCountry: string;
  adults: number;
  children: number;
}

/** Bookings made in the guest window, live. Pending bookings and other hotels are out. */
export async function loadGuestDetails(propertyId: string, today: IsoDate): Promise<GuestDetail[]> {
  const window = guestWindow(today);
  const rows = await query<{
    reservation_id: string;
    user_id: string;
    country: string | null;
    adults: number;
    children: number;
  }>(
    `SELECT r.id AS reservation_id, b.user_id, gp.country, r.adults, r.children
       FROM bookings b
       JOIN reservations r ON r.booking_id = b.id
       LEFT JOIN guest_profile gp ON gp.user_id = b.user_id
      WHERE b.hotel_id = $1 AND b.status <> 'pending'
        AND (coalesce(b.confirmed_at, b.created_at) AT TIME ZONE '${AMS}')::date BETWEEN $2::date AND $3::date`,
    [propertyId, window.from, window.to],
  );
  return rows.map((r) => ({
    reservationId: r.reservation_id,
    guestKey: r.user_id,
    guestCountry: r.country?.trim() ? r.country.trim().toUpperCase() : "ZZ",
    adults: r.adults,
    children: r.children,
  }));
}

/** Facts whose reservation has details get them; every other fact keeps its neutral values. */
export function attachGuestDetails(facts: Facts, details: GuestDetail[]): Facts {
  const byReservation = new Map(details.map((d) => [d.reservationId, d]));
  return {
    ...facts,
    bookings: facts.bookings.map((b) => {
      const d = byReservation.get(b.id);
      return d
        ? { ...b, guestKey: d.guestKey, guestCountry: d.guestCountry, adults: d.adults, children: d.children, hasGuestDetails: true }
        : b;
    }),
  };
}
