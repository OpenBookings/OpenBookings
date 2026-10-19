import { propertyReadAccessSql } from "@openbookings/authz";
import { query } from "@openbookings/db";

/**
 * Booking lookups for host tickets. Every query is scoped in SQL to the
 * properties the host user can read (owner, org-wide role, or a
 * property_access row), so an out-of-scope booking and a missing one return
 * the same thing: nothing.
 *
 * Kept apart from the guest lookups in @openbookings/db (support.ts): a guest
 * reaches bookings by their own email, a host by the properties they run.
 * Neither path can call the other's queries.
 */

export type HostBookingRoom = {
  room_name: string;
  rate_plan_name: string;
  is_refundable: boolean;
  cancellation_policy: string | null;
  adults: number;
  children: number;
  total_nights: number;
};

export type HostBooking = {
  booking_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  booking_fee_amount: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  /** For the payment lookup only; never shown to the model. */
  stripe_account_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  guest_name: string | null;
  property_name: string;
  rooms: HostBookingRoom[];
};

const SELECT = `
  SELECT
    b.id::text AS booking_id,
    b.status::text AS status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    b.total_amount::bigint AS total_amount,
    b.booking_fee_amount::bigint AS booking_fee_amount,
    b.currency,
    b.stripe_payment_intent_id,
    p.stripe_account_id,
    b.cancellation_reason,
    b.cancelled_at::text AS cancelled_at,
    b.created_at::text AS created_at,
    u.name AS guest_name,
    p.name AS property_name,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'room_name', rm.name,
          'rate_plan_name', rp.name,
          'is_refundable', rp.is_refundable,
          'cancellation_policy', rp.cancellation_policy,
          'adults', r.adults,
          'children', r.children,
          'total_nights', r.total_nights
        ) ORDER BY rm.name)
        FROM reservations r
        JOIN rooms rm ON rm.id = r.room_id
        JOIN rate_plans rp ON rp.id = r.rate_plan_id
        WHERE r.booking_id = b.id
      ),
      '[]'::json
    ) AS rooms
  FROM bookings b
  JOIN properties p ON p.id = b.hotel_id
  LEFT JOIN "user" u ON u.id = b.user_id
`;

/**
 * A booking reference as hosts write it: the full UUID, or its first 8+
 * characters (the short `#a1b2c3d4` form the business app shows), with or
 * without the `#`. Returns the lowercased prefix, or null when it can't be
 * a booking id at all.
 */
export function normalizeBookingReference(raw: string): string | null {
  const ref = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) return ref;
  if (/^[0-9a-f]{8}(-[0-9a-f]{0,4})?$/.test(ref)) return ref;
  return null;
}

export type HostBookingMatch =
  | { kind: "found"; booking: HostBooking }
  | { kind: "none" }
  | { kind: "ambiguous" };

/** Find one of the host's bookings by reference (full or short). */
export async function findHostBooking(userId: string, reference: string): Promise<HostBookingMatch> {
  const ref = normalizeBookingReference(reference);
  if (!ref || !userId) return { kind: "none" };
  const rows = await query<HostBooking>(
    `${SELECT}
     WHERE b.id::text LIKE $2 || '%' AND ${propertyReadAccessSql("$1")}
     ORDER BY b.created_at DESC
     LIMIT 2`,
    [userId, ref],
  );
  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "ambiguous" };
  return { kind: "found", booking: rows[0]! };
}

/** The host's most recent bookings across the properties they can read. */
export async function listHostBookings(userId: string, limit = 5): Promise<HostBooking[]> {
  if (!userId) return [];
  return query<HostBooking>(
    `${SELECT}
     WHERE ${propertyReadAccessSql("$1")}
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
}
