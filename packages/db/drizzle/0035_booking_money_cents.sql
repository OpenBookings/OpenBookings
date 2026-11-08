-- 0035_booking_money_cents — the booking keeps its exact money split.
--
-- bookings.total_amount is whole euros, so a €463.50 stay was stored as 464,
-- and the commission and tourist tax were only on the booking intent. These
-- columns hold what the guest paid, in cents, split the way it was charged:
--
--   rooms_total_cents  the stay, VAT included (commission is taken on this)
--   tourist_tax_cents  passed through to the host, never commissioned
--   total_cents        rooms_total_cents + tourist_tax_cents
--   commission_cents   OpenBookings' application fee; 0 while it is switched off
--
-- total_amount stays as it was for the code that still reads it.
--
-- Backfill: from the booking's intent where it has one, otherwise from its
-- reservations (the per-night prices, or total_amount for rows from before
-- 0027 that have no nights). Only rows still at zero are touched.
--
-- Additive: safe for the code running before this deploy, which leaves the
-- defaults in place. Re-runnable.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rooms_total_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tourist_tax_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_cents bigint NOT NULL DEFAULT 0;

UPDATE bookings b
SET rooms_total_cents = round((i.snapshot->>'roomsTotal')::numeric * 100),
    tourist_tax_cents = round(i.tourist_tax_amount * 100),
    total_cents       = round((i.snapshot->>'roomsTotal')::numeric * 100) + round(i.tourist_tax_amount * 100),
    commission_cents  = i.commission_cents
FROM booking_intents i
WHERE i.booking_id = b.id
  AND b.total_cents = 0;

UPDATE bookings b
SET rooms_total_cents = r.rooms_cents,
    tourist_tax_cents = r.tax_cents,
    total_cents       = r.rooms_cents + r.tax_cents
FROM (
  SELECT booking_id,
         sum(CASE WHEN jsonb_array_length(nights) > 0
                  THEN (SELECT round(sum((n->>'price')::numeric) * 100) FROM jsonb_array_elements(nights) n)
                  ELSE total_amount * 100 END) AS rooms_cents,
         sum(round(tourist_tax_amount * 100)) AS tax_cents
  FROM reservations
  GROUP BY booking_id
) r
WHERE r.booking_id = b.id
  AND b.total_cents = 0;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_money_cents;
ALTER TABLE bookings ADD CONSTRAINT bookings_money_cents CHECK (
  rooms_total_cents >= 0
  AND tourist_tax_cents >= 0
  AND commission_cents >= 0
  AND total_cents = rooms_total_cents + tourist_tax_cents
);
