-- 0051_eur_only — OpenBookings takes euros only.
--
-- Every amount is in EUR: rates, bookings, payments and checkout intents.
-- The currency columns stay (Stripe and the invoices read them), but the
-- database now refuses anything other than 'EUR', so a stray currency can't
-- slip in through a seed, a script or a future code path.
--
--   rate_plans.currency       CHECK (currency = 'EUR')
--   bookings.currency         CHECK (currency = 'EUR')
--   transactions.currency     CHECK (currency = 'EUR')
--   booking_intents.currency  CHECK (currency = 'EUR')
--
-- Adding a check validates existing rows; every row is EUR today.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE rate_plans DROP CONSTRAINT IF EXISTS rate_plans_currency_eur;
ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_currency_eur CHECK (currency = 'EUR');

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_currency_eur;
ALTER TABLE bookings ADD CONSTRAINT bookings_currency_eur CHECK (currency = 'EUR');

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_currency_eur;
ALTER TABLE transactions ADD CONSTRAINT transactions_currency_eur CHECK (currency = 'EUR');

ALTER TABLE booking_intents DROP CONSTRAINT IF EXISTS booking_intents_currency_eur;
ALTER TABLE booking_intents ADD CONSTRAINT booking_intents_currency_eur CHECK (currency = 'EUR');
