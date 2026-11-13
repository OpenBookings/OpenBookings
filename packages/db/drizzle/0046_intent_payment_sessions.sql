-- 0046_intent_payment_sessions — every Checkout Session the platform made for a booking intent.
--
-- A paid session confirms an intent only when it is one of these: made by the
-- platform for that intent, on that connected account, for that amount. Any
-- other paid session naming the intent in its metadata is refused. Kept per
-- session, not on the intent, because a replaced session can still be paid
-- late (a bank debit that clears after the guest started again).
--
--   session_id    the Stripe Checkout Session
--   intent_id     the booking intent it was made for
--   account_id    the connected account it lives on (the property's)
--   amount_cents  amount_total as Stripe made it, in cents
--
-- No backfill: an intent still open when this ships has no row, so its payment
-- is refused and reported instead of confirmed.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS booking_intent_payment_sessions (
  session_id text PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES booking_intents(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  amount_cents bigint NOT NULL CONSTRAINT booking_intent_payment_sessions_amount_cents_check CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_intent_payment_sessions_intent ON booking_intent_payment_sessions (intent_id);
