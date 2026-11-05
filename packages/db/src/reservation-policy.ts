import { reservationPolicy, type PropertyCancellationTier, type TouristTaxRule } from "@openbookings/pricing";
import { recordBookingEvent } from "./booking-events";

/** A pg Client, PoolClient or Pool: anything that runs a parameterised query. */
export type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type ReservationRow = {
  reservation_id: string;
  check_in_date: string;
  price_per_night: string;
  total_nights: number;
  adults: number;
  children: number;
  is_refundable: boolean;
  cancellation_tier: PropertyCancellationTier;
  timezone: string;
  check_in_time: string | null;
  tourist_tax_rules: TouristTaxRule[];
};

const DAY = 86_400_000;

/**
 * Confirm a paid booking and fix the cancellation policy each room was booked
 * under (Annex B B.1.3: a later tier change never touches an existing booking).
 *
 * The code that turns a Stripe payment into a booking calls this; until that
 * exists, the seed does. `nightPrices` is the price per night the guest was
 * charged, per reservation id; a reservation without an entry is valued at its
 * flat `price_per_night`.
 *
 * Idempotent: a reservation that already has a snapshot is left alone, and
 * `confirmed_at` is only set once.
 */
export async function confirmBookingPolicy(
  db: Queryable,
  input: {
    bookingId: string;
    confirmedAt: Date;
    nightPrices?: Record<string, { date: string; price: number }[]>;
  },
): Promise<void> {
  const { rows } = await db.query(
    `SELECT res.id AS reservation_id, b.check_in_date::text AS check_in_date,
            res.price_per_night, res.total_nights, res.adults, res.children,
            rp.is_refundable, p.cancellation_tier, p.timezone,
            to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
            COALESCE((
              SELECT json_agg(json_build_object(
                'effectiveFrom', t.effective_from::text,
                'charges', t.charges,
                'childrenExempt', t.children_exempt,
                'maxNights', t.max_nights
              ) ORDER BY t.effective_from)
              FROM tourist_tax_rules t WHERE t.property_id = p.id
            ), '[]'::json) AS tourist_tax_rules
     FROM bookings b
     JOIN properties p     ON p.id = b.hotel_id
     JOIN reservations res ON res.booking_id = b.id
     JOIN rate_plans rp    ON rp.id = res.rate_plan_id
     WHERE b.id = $1 AND res.check_in_at IS NULL`,
    [input.bookingId],
  );

  for (const row of rows as ReservationRow[]) {
    const start = Date.parse(`${row.check_in_date}T00:00:00Z`);
    const nightPrices =
      input.nightPrices?.[row.reservation_id] ??
      Array.from({ length: row.total_nights }, (_, i) => ({
        date: new Date(start + i * DAY).toISOString().slice(0, 10),
        price: Number(row.price_per_night),
      }));

    const { snapshot, nights } = reservationPolicy({
      propertyTier: row.cancellation_tier,
      isRefundable: row.is_refundable,
      timeZone: row.timezone,
      checkInTime: row.check_in_time,
      arrivalDate: row.check_in_date,
      confirmedAt: input.confirmedAt,
      nightPrices,
      touristTaxRules: row.tourist_tax_rules,
      adults: row.adults,
      children: row.children,
    });
    const touristTax = nights.reduce((sum, n) => sum + Math.round(n.touristTax * 100), 0) / 100;

    await db.query(
      `UPDATE reservations
       SET cancellation_tier = $1::reservation_cancellation_tier, check_in_at = $2,
           full_refund_until = $3, nights = $4::jsonb, policy_version = $5, tourist_tax_amount = $6
       WHERE id = $7`,
      [
        snapshot.tier,
        snapshot.checkInAt,
        snapshot.fullRefundUntil,
        JSON.stringify(nights),
        snapshot.policyVersion,
        touristTax,
        row.reservation_id,
      ],
    );
  }

  const { rows: confirmed } = await db.query(
    `UPDATE bookings
     SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, $2), updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [input.bookingId, input.confirmedAt],
  );
  if (confirmed.length > 0) {
    await recordBookingEvent(db, { bookingId: input.bookingId, kind: "confirmed", actor: { kind: "system", id: null } });
  }
}
