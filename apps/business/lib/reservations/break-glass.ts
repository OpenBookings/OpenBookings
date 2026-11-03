"use server";

import { userCan } from "@openbookings/authz";
import { query, queryOne } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { toGuestContact, type GuestContact, type GuestContactRow } from "./shape";

/**
 * Break the glass on one booking: the guest's contact details, for a member
 * who may read bookings at its property, and a record that they looked.
 *
 * The reservations list never carries these details, so the frosted panel
 * is not just a curtain over data already in the browser: until this runs,
 * the details are not on the page at all.
 *
 * The audit row is written BEFORE the details are returned, and a failed
 * write refuses the request. An access that cannot be recorded does not
 * happen.
 */
export async function breakGlass(bookingId: string): Promise<{ contact: GuestContact } | { error: string }> {
  const session = await getServerSession();
  if (!session) return { error: "Sign in again to view these details." };
  if (typeof bookingId !== "string" || !bookingId) return { error: "Booking not found." };

  const booking = await queryOne<GuestContactRow & { hotel_id: string; organization_id: string | null }>(
    `SELECT b.hotel_id, p.organization_id,
            gp.phone AS guest_phone,
            CASE WHEN gp.address_line1 IS NOT NULL THEN json_build_object(
              'line1', gp.address_line1, 'line2', gp.address_line2,
              'postal_code', gp.postal_code, 'city', gp.city, 'country', gp.country
            ) END AS guest_address
     FROM bookings b
     JOIN properties p ON p.id = b.hotel_id
     LEFT JOIN guest_profile gp ON gp.user_id = b.user_id
     WHERE b.id = $1::uuid`,
    [bookingId],
  ).catch(() => null);

  // Out of scope and missing look the same.
  if (!booking || !(await userCan(session, booking.hotel_id, { booking: ["read"] }))) {
    return { error: "Booking not found." };
  }

  try {
    await query(
      `INSERT INTO audit_log (action, actor_user_id, organization_id, detail)
       VALUES ('booking.glass-broken', $1, $2, $3)`,
      [session.user.id, booking.organization_id, JSON.stringify({ bookingId, propertyId: booking.hotel_id })],
    );
  } catch (error) {
    console.error("[break-glass] audit write failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't open these details just now. Please try again." };
  }

  return { contact: toGuestContact(booking) };
}
