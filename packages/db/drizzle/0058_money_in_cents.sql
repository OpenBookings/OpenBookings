-- 0058_money_in_cents — every money amount is an integer number of cents.
--
-- Until now prices were whole euros (rate_plans.bar, rate overrides, room
-- fees), fixed-point euros (refunds, tourist tax, intents) or float euros in
-- JSON (night prices, VAT splits, tax lines, intent snapshots). Mixed units
-- invite float drift and silent 100x mistakes. From here on every amount is a
-- bigint number of cents, and every converted column or JSON key is renamed
-- with a `_cents` / `Cents` suffix, so a reader that was missed fails loudly
-- (unknown column, missing key) instead of showing €0.89 for €89.
--
-- Columns (euros -> cents, numeric values rounded half away from zero):
--   rate_plans.bar                              -> bar_cents
--   rate_overrides.price_per_night              -> price_per_night_cents
--   rooms.extra_adult_fee|extra_child_fee|cot_fee|extra_bed_fee -> ..._fee_cents
--   properties.breakfast_value                  -> breakfast_value_cents
--   rate_modifiers.adjustment_value             x100 for 'flat' rules only (a
--                                               percentage stays a percentage)
--   reservations.price_per_night                -> price_per_night_cents
--   reservations.total_amount                   -> total_cents
--   reservations.tourist_tax_amount             -> tourist_tax_cents
--   reservations.pay_at_property_amount         -> pay_at_property_cents
--   refunds.accommodation_amount|tourist_tax_amount|amount
--                                               -> accommodation_cents|tourist_tax_cents|amount_cents
--   booking_intents.total_amount|tourist_tax_amount -> total_cents|tourist_tax_cents
--   booking_intents.commission_cents            integer -> bigint
--   booking_intent_rooms.pay_at_property_amount|discount_amount|stay_total|tourist_tax_amount
--                                               -> pay_at_property_cents|discount_cents|stay_total_cents|tourist_tax_cents
--   transactions.amount (whole euros)           -> amount_cents, the exact charge
--                                               from metadata.amountCents where kept
--   bookings.total_amount, bookings.booking_fee_amount: dropped. The booking's
--                                               cents columns (0035) hold its money;
--                                               rows still at 0 are backfilled first.
--
-- reservations.price_per_night and total_amount were rounded to whole euros.
-- Where the reservation has its night prices (every confirmed one), the cents
-- come from those, exact; otherwise from the whole euros x 100.
--
-- JSON (keys renamed, values to cents; labels such as "€2.50 per person per
-- night" stay as written):
--   tourist_tax_rules.charges[]     fixed: amount -> amountCents; percent: amount -> percent
--   reservations.nights[]           price, touristTax -> priceCents, touristTaxCents
--   *.tourist_tax_lines[]           amount -> amountCents
--   *.vat_split                     gross, vat -> grossCents, vatCents (nights and totals)
--   booking_intent_rooms.nights[], rate_nights[]   price -> priceCents
--   booking_intent_rooms.extra_guests[]            per_night, amount -> perNightCents, amountCents
--   booking_intent_rooms.pay_at_property_lines[]   fee_per_night, amount -> feePerNightCents, amountCents
--   booking_intents.snapshot        roomsTotal, touristTaxTotal, total -> ...Cents
--                                   (an intent made before the deploy and paid after it
--                                   still matches Stripe's amount_total exactly)
--   refunds.breakdown               refund/retained {accommodation, touristTax, total} -> ...Cents;
--                                   goodwill {requested, capped} -> ...Cents
--   booking_events.data             amount -> amountCents (refund_*, outside_refund, goodwill_refund),
--                                   requested -> requestedCents (goodwill_refund),
--                                   refundTotal -> refundTotalCents (rooms_cancelled),
--                                   roomPrice, touristTax -> ...Cents (outside_refund_explained),
--                                   snapshotTotal -> snapshotTotalCents (confirmed),
--                                   the deleted refund row of forced_refund_deleted likewise.
--
-- Check constraints that compared euro amounts are recreated on the new
-- columns with the same meaning. refunds_amounts_finite (0030) is dropped: a
-- bigint cannot be NaN. The analytics trigger on refunds (0057) names
-- accommodation_amount, which blocks its type change, so it is recreated on
-- accommodation_cents.
--
-- Deploy: renames break the code running before this deploy; the release job
-- migrates before rolling containers, so old containers error for a minute.
--
-- Idempotent: every conversion runs only while its old column or JSON key is
-- still there, so a second run changes nothing. The flat modifiers have no
-- name to rename; they convert together with rate_plans.bar, under its guard.
-- One transaction (migrate-ci.ts): it converts all of it or none of it.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Helpers, for this session only (dropped at the end)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.ob_has_column(tbl text, col text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.' || tbl) AND attname = col AND attnum > 0 AND NOT attisdropped
  )
$$;

-- A JSON euro amount (number or numeric string) as a JSON number of cents. null stays null.
CREATE OR REPLACE FUNCTION pg_temp.ob_cents(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN v; END IF;
  RETURN to_jsonb(round((v #>> '{}')::numeric * 100)::bigint);
END
$$;

-- Move each `old` key of an object to its `new` key, in cents. pairs = {old1, new1, old2, new2, ...}.
-- A key that is not there (already moved) is left alone; anything but an object is returned as is.
CREATE OR REPLACE FUNCTION pg_temp.ob_rekey(o jsonb, pairs text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(o) IS DISTINCT FROM 'object' THEN RETURN o; END IF;
  FOR i IN 1 .. coalesce(array_length(pairs, 1), 0) / 2 LOOP
    IF o ? pairs[2 * i - 1] THEN
      o := (o - pairs[2 * i - 1]) || jsonb_build_object(pairs[2 * i], pg_temp.ob_cents(o -> pairs[2 * i - 1]));
    END IF;
  END LOOP;
  RETURN o;
END
$$;

-- ob_rekey on every element of an array, in order.
CREATE OR REPLACE FUNCTION pg_temp.ob_rekey_each(arr jsonb, pairs text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(arr) IS DISTINCT FROM 'array' THEN RETURN arr; END IF;
  RETURN coalesce(
    (SELECT jsonb_agg(pg_temp.ob_rekey(e, pairs) ORDER BY i) FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(e, i)),
    '[]'::jsonb
  );
END
$$;

-- One night of a VatSplit: its room and breakfast parts (breakfast may be null).
CREATE OR REPLACE FUNCTION pg_temp.ob_vat_night(n jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts CONSTANT text[] := ARRAY['gross', 'grossCents', 'vat', 'vatCents'];
BEGIN
  IF jsonb_typeof(n) IS DISTINCT FROM 'object' THEN RETURN n; END IF;
  IF jsonb_typeof(n -> 'room') = 'object' THEN
    n := jsonb_set(n, '{room}', pg_temp.ob_rekey(n -> 'room', parts));
  END IF;
  IF jsonb_typeof(n -> 'breakfast') = 'object' THEN
    n := jsonb_set(n, '{breakfast}', pg_temp.ob_rekey(n -> 'breakfast', parts));
  END IF;
  RETURN n;
END
$$;

-- A VatSplit: gross/vat -> grossCents/vatCents in every night's room and breakfast part, and in totals.
CREATE OR REPLACE FUNCTION pg_temp.ob_vat_split(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN v; END IF;
  IF jsonb_typeof(v -> 'totals') = 'array' THEN
    v := jsonb_set(v, '{totals}', pg_temp.ob_rekey_each(v -> 'totals', ARRAY['gross', 'grossCents', 'vat', 'vatCents']));
  END IF;
  IF jsonb_typeof(v -> 'nights') = 'array' THEN
    v := jsonb_set(v, '{nights}', coalesce(
      (SELECT jsonb_agg(pg_temp.ob_vat_night(n) ORDER BY i) FROM jsonb_array_elements(v -> 'nights') WITH ORDINALITY AS t(n, i)),
      '[]'::jsonb));
  END IF;
  RETURN v;
END
$$;

-- A refund's breakdown: the calculator's RefundResult, or a goodwill refund's {requested, capped}.
CREATE OR REPLACE FUNCTION pg_temp.ob_refund_breakdown(b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  amounts CONSTANT text[] := ARRAY['accommodation', 'accommodationCents', 'touristTax', 'touristTaxCents', 'total', 'totalCents'];
BEGIN
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' THEN RETURN b; END IF;
  IF jsonb_typeof(b -> 'refund') = 'object' THEN
    b := jsonb_set(b, '{refund}', pg_temp.ob_rekey(b -> 'refund', amounts));
  END IF;
  IF jsonb_typeof(b -> 'retained') = 'object' THEN
    b := jsonb_set(b, '{retained}', pg_temp.ob_rekey(b -> 'retained', amounts));
  END IF;
  RETURN pg_temp.ob_rekey(b, ARRAY['requested', 'requestedCents', 'capped', 'cappedCents']);
END
$$;

-- Rename tbl.old to tbl.new and convert it to bigint cents: x100 for a bigint of
-- whole euros, round(x * 100) for a numeric of euros. A default must be 0 and
-- stays 0. Check constraints on the column are the caller's. Returns false,
-- changing nothing, once `old` is gone.
CREATE OR REPLACE FUNCTION pg_temp.ob_to_cents(tbl text, old text, new text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  col_type regtype;
  dflt text;
  dflt_zero boolean;
BEGIN
  IF NOT pg_temp.ob_has_column(tbl, old) THEN RETURN false; END IF;
  SELECT a.atttypid::regtype, pg_get_expr(d.adbin, d.adrelid)
    INTO col_type, dflt
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.' || tbl) AND a.attname = old;
  IF dflt IS NOT NULL THEN
    EXECUTE format('SELECT (%s)::numeric = 0', dflt) INTO dflt_zero;
    IF dflt_zero IS NOT TRUE THEN
      RAISE EXCEPTION '0058: %.% has default %, expected 0', tbl, old, dflt;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', tbl, old);
  END IF;
  EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', tbl, old, new);
  IF col_type = 'numeric'::regtype THEN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %2$I TYPE bigint USING round(%2$I * 100)::bigint', tbl, new);
  ELSIF col_type = 'bigint'::regtype THEN
    EXECUTE format('UPDATE %I SET %2$I = %2$I * 100 WHERE %2$I IS NOT NULL', tbl, new);
  ELSE
    RAISE EXCEPTION '0058: %.% is %, expected numeric or bigint', tbl, old, col_type;
  END IF;
  IF dflt IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT 0', tbl, new);
  END IF;
  RETURN true;
END
$$;

-- Cents of a reservation's nights, from either shape (price euros or priceCents). Null when it has none.
CREATE OR REPLACE FUNCTION pg_temp.ob_nights_cents(nights jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT sum(coalesce((n ->> 'priceCents')::numeric, round((n ->> 'price')::numeric * 100)))
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nights) = 'array' THEN nights ELSE '[]'::jsonb END) n
$$;

-- ---------------------------------------------------------------------------
-- Prices the host sets
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_temp.ob_to_cents('rate_plans', 'bar', 'bar_cents') THEN
    -- A flat modifier is euros per night; a percent one stays a percentage.
    -- Converted under bar's guard: adjustment_value keeps its name.
    UPDATE rate_modifiers SET adjustment_value = adjustment_value * 100 WHERE adjustment_type = 'flat';
    ALTER TABLE rate_plans DROP CONSTRAINT IF EXISTS rate_plans_base_price_positive;
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_base_price_positive CHECK (bar_cents >= 0);
  END IF;

  IF pg_temp.ob_to_cents('rate_overrides', 'price_per_night', 'price_per_night_cents') THEN
    ALTER TABLE rate_overrides DROP CONSTRAINT IF EXISTS rate_overrides_price_positive;
    ALTER TABLE rate_overrides ADD CONSTRAINT rate_overrides_price_positive CHECK (price_per_night_cents >= 0);
  END IF;

  IF pg_temp.ob_to_cents('rooms', 'extra_adult_fee', 'extra_adult_fee_cents') THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_extra_adult_fee_check;
    ALTER TABLE rooms ADD CONSTRAINT rooms_extra_adult_fee_cents_check CHECK (extra_adult_fee_cents >= 0);
  END IF;
  IF pg_temp.ob_to_cents('rooms', 'extra_child_fee', 'extra_child_fee_cents') THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_extra_child_fee_check;
    ALTER TABLE rooms ADD CONSTRAINT rooms_extra_child_fee_cents_check CHECK (extra_child_fee_cents >= 0);
  END IF;
  IF pg_temp.ob_to_cents('rooms', 'cot_fee', 'cot_fee_cents') THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_cot_fee_check;
    ALTER TABLE rooms ADD CONSTRAINT rooms_cot_fee_cents_check CHECK (cot_fee_cents >= 0);
  END IF;
  IF pg_temp.ob_to_cents('rooms', 'extra_bed_fee', 'extra_bed_fee_cents') THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_extra_bed_fee_check;
    ALTER TABLE rooms ADD CONSTRAINT rooms_extra_bed_fee_cents_check CHECK (extra_bed_fee_cents >= 0);
  END IF;

  IF pg_temp.ob_to_cents('properties', 'breakfast_value', 'breakfast_value_cents') THEN
    ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_breakfast_value_check;
    ALTER TABLE properties ADD CONSTRAINT properties_breakfast_value_cents_check CHECK (breakfast_value_cents >= 0);
  END IF;
END
$$;

-- Fixed charges are euros; a percent charge's `amount` was always a percentage.
UPDATE tourist_tax_rules
   SET charges = (
     SELECT jsonb_agg(
              CASE
                WHEN NOT c ? 'amount' THEN c
                WHEN c ->> 'kind' = 'percent' THEN (c - 'amount') || jsonb_build_object('percent', c -> 'amount')
                ELSE pg_temp.ob_rekey(c, ARRAY['amount', 'amountCents'])
              END
              ORDER BY i)
       FROM jsonb_array_elements(charges) WITH ORDINALITY AS t(c, i)
   )
 WHERE jsonb_path_exists(charges, '$[*].amount');

-- ---------------------------------------------------------------------------
-- Bookings: drop the whole-euro columns, after filling any cents still at 0
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_temp.ob_has_column('bookings', 'total_amount') THEN
    -- As 0035: from the reservations' nights (else their whole-euro total) and tourist tax.
    UPDATE bookings b
       SET rooms_total_cents = r.rooms_cents,
           tourist_tax_cents = r.tax_cents,
           total_cents = r.rooms_cents + r.tax_cents
      FROM (
        SELECT booking_id,
               sum(coalesce(pg_temp.ob_nights_cents(nights), total_amount * 100)) AS rooms_cents,
               sum(round(tourist_tax_amount * 100)) AS tax_cents
          FROM reservations
         GROUP BY booking_id
      ) r
     WHERE r.booking_id = b.id AND b.total_cents = 0;
    -- No reservations: the whole-euro total is all there is.
    UPDATE bookings
       SET rooms_total_cents = total_amount * 100,
           total_cents = total_amount * 100 + tourist_tax_cents
     WHERE total_cents = 0 AND total_amount > 0;

    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_total_positive;
    ALTER TABLE bookings DROP COLUMN total_amount;
  END IF;
END
$$;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_fee_positive;
ALTER TABLE bookings DROP COLUMN IF EXISTS booking_fee_amount;

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Whole euros, rounded; the nights (read before their keys move below) hold the exact price.
  IF pg_temp.ob_has_column('reservations', 'price_per_night') THEN
    ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_price_positive;
    ALTER TABLE reservations RENAME COLUMN price_per_night TO price_per_night_cents;
    UPDATE reservations
       SET price_per_night_cents = coalesce(
             round(pg_temp.ob_nights_cents(nights) / nullif(jsonb_array_length(nights), 0)),
             price_per_night_cents * 100);
    ALTER TABLE reservations ADD CONSTRAINT reservations_price_positive CHECK (price_per_night_cents >= 0);
  END IF;
  IF pg_temp.ob_has_column('reservations', 'total_amount') THEN
    ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_total_positive;
    ALTER TABLE reservations RENAME COLUMN total_amount TO total_cents;
    UPDATE reservations SET total_cents = coalesce(pg_temp.ob_nights_cents(nights), total_cents * 100);
    ALTER TABLE reservations ADD CONSTRAINT reservations_total_positive CHECK (total_cents >= 0);
  END IF;

  PERFORM pg_temp.ob_to_cents('reservations', 'tourist_tax_amount', 'tourist_tax_cents');
  IF pg_temp.ob_to_cents('reservations', 'pay_at_property_amount', 'pay_at_property_cents') THEN
    ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_pay_at_property_amount_check;
    ALTER TABLE reservations ADD CONSTRAINT reservations_pay_at_property_cents_check CHECK (pay_at_property_cents >= 0);
  END IF;
END
$$;

UPDATE reservations
   SET nights = pg_temp.ob_rekey_each(nights, ARRAY['price', 'priceCents', 'touristTax', 'touristTaxCents'])
 WHERE jsonb_path_exists(nights, '$[*] ? (exists(@.price) || exists(@.touristTax))');

UPDATE reservations
   SET tourist_tax_lines = pg_temp.ob_rekey_each(tourist_tax_lines, ARRAY['amount', 'amountCents'])
 WHERE jsonb_path_exists(tourist_tax_lines, '$[*].amount');

UPDATE reservations
   SET vat_split = pg_temp.ob_vat_split(vat_split)
 WHERE jsonb_path_exists(vat_split, '$.** ? (exists(@.gross) || exists(@.vat))');

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  had_trigger boolean;
BEGIN
  IF pg_temp.ob_has_column('refunds', 'amount') THEN
    -- 0057's trigger lists accommodation_amount, which blocks a type change.
    had_trigger := EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'refunds'::regclass AND tgname = 'analytics_cache_refunds'
    );
    DROP TRIGGER IF EXISTS analytics_cache_refunds ON refunds;
    -- The sum would compare cents with euros mid-way; NaN cannot exist in a bigint.
    ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_amount_sum;
    ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_amounts_finite;

    PERFORM pg_temp.ob_to_cents('refunds', 'accommodation_amount', 'accommodation_cents');
    PERFORM pg_temp.ob_to_cents('refunds', 'tourist_tax_amount', 'tourist_tax_cents');
    PERFORM pg_temp.ob_to_cents('refunds', 'amount', 'amount_cents');

    ALTER TABLE refunds ADD CONSTRAINT refunds_amount_sum
      CHECK (amount_cents = accommodation_cents + tourist_tax_cents AND amount_cents >= 0);
    IF had_trigger THEN
      CREATE TRIGGER analytics_cache_refunds
        AFTER INSERT OR DELETE OR UPDATE OF booking_id, reservation_id, accommodation_cents, status
        ON refunds
        FOR EACH ROW EXECUTE FUNCTION app.analytics_booking_child_changed();
    END IF;
  END IF;
END
$$;

UPDATE refunds
   SET breakdown = pg_temp.ob_refund_breakdown(breakdown)
 WHERE breakdown ?| ARRAY['requested', 'capped']
    OR breakdown -> 'refund' ?| ARRAY['accommodation', 'touristTax', 'total']
    OR breakdown -> 'retained' ?| ARRAY['accommodation', 'touristTax', 'total'];

-- ---------------------------------------------------------------------------
-- Booking intents
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM pg_temp.ob_to_cents('booking_intents', 'total_amount', 'total_cents');
  PERFORM pg_temp.ob_to_cents('booking_intents', 'tourist_tax_amount', 'tourist_tax_cents');
  IF (SELECT atttypid FROM pg_attribute
       WHERE attrelid = 'booking_intents'::regclass AND attname = 'commission_cents') = 'integer'::regtype THEN
    ALTER TABLE booking_intents ALTER COLUMN commission_cents TYPE bigint;
  END IF;

  PERFORM pg_temp.ob_to_cents('booking_intent_rooms', 'stay_total', 'stay_total_cents');
  PERFORM pg_temp.ob_to_cents('booking_intent_rooms', 'tourist_tax_amount', 'tourist_tax_cents');
  IF pg_temp.ob_to_cents('booking_intent_rooms', 'pay_at_property_amount', 'pay_at_property_cents') THEN
    ALTER TABLE booking_intent_rooms DROP CONSTRAINT IF EXISTS booking_intent_rooms_pay_at_property_amount_check;
    ALTER TABLE booking_intent_rooms
      ADD CONSTRAINT booking_intent_rooms_pay_at_property_cents_check CHECK (pay_at_property_cents >= 0);
  END IF;
  IF pg_temp.ob_to_cents('booking_intent_rooms', 'discount_amount', 'discount_cents') THEN
    ALTER TABLE booking_intent_rooms DROP CONSTRAINT IF EXISTS booking_intent_rooms_discount_amount_check;
    ALTER TABLE booking_intent_rooms ADD CONSTRAINT booking_intent_rooms_discount_cents_check CHECK (discount_cents > 0);
  END IF;
END
$$;

UPDATE booking_intents
   SET snapshot = pg_temp.ob_rekey(snapshot, ARRAY[
         'roomsTotal', 'roomsTotalCents', 'touristTaxTotal', 'touristTaxTotalCents', 'total', 'totalCents'])
 WHERE snapshot ?| ARRAY['roomsTotal', 'touristTaxTotal', 'total'];

UPDATE booking_intent_rooms
   SET nights = pg_temp.ob_rekey_each(nights, ARRAY['price', 'priceCents', 'touristTax', 'touristTaxCents'])
 WHERE jsonb_path_exists(nights, '$[*] ? (exists(@.price) || exists(@.touristTax))');

UPDATE booking_intent_rooms
   SET rate_nights = pg_temp.ob_rekey_each(rate_nights, ARRAY['price', 'priceCents'])
 WHERE jsonb_path_exists(rate_nights, '$[*].price');

UPDATE booking_intent_rooms
   SET extra_guests = pg_temp.ob_rekey_each(extra_guests, ARRAY['per_night', 'perNightCents', 'amount', 'amountCents'])
 WHERE jsonb_path_exists(extra_guests, '$[*] ? (exists(@.per_night) || exists(@.amount))');

UPDATE booking_intent_rooms
   SET pay_at_property_lines = pg_temp.ob_rekey_each(
         pay_at_property_lines, ARRAY['fee_per_night', 'feePerNightCents', 'amount', 'amountCents'])
 WHERE jsonb_path_exists(pay_at_property_lines, '$[*] ? (exists(@.fee_per_night) || exists(@.amount))');

UPDATE booking_intent_rooms
   SET tourist_tax_lines = pg_temp.ob_rekey_each(tourist_tax_lines, ARRAY['amount', 'amountCents'])
 WHERE jsonb_path_exists(tourist_tax_lines, '$[*].amount');

UPDATE booking_intent_rooms
   SET vat_split = pg_temp.ob_vat_split(vat_split)
 WHERE jsonb_path_exists(vat_split, '$.** ? (exists(@.gross) || exists(@.vat))');

-- ---------------------------------------------------------------------------
-- Transactions: the exact charge, kept in metadata since 0035, else whole euros
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_temp.ob_has_column('transactions', 'amount') THEN
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_cents bigint;
    UPDATE transactions
       SET amount_cents = coalesce(round((metadata ->> 'amountCents')::numeric)::bigint, amount * 100);
    ALTER TABLE transactions ALTER COLUMN amount_cents SET NOT NULL;
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_amount_positive;
    ALTER TABLE transactions DROP COLUMN amount;
    ALTER TABLE transactions ADD CONSTRAINT transactions_amount_positive CHECK (amount_cents > 0);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Booking events
-- ---------------------------------------------------------------------------

UPDATE booking_events
   SET data = pg_temp.ob_rekey(data, ARRAY['amount', 'amountCents'])
 WHERE kind IN ('refund_succeeded', 'refund_failed', 'refund_uncertain', 'outside_refund')
   AND data ? 'amount';

UPDATE booking_events
   SET data = pg_temp.ob_rekey(data, ARRAY['requested', 'requestedCents', 'amount', 'amountCents'])
 WHERE kind = 'goodwill_refund' AND data ?| ARRAY['requested', 'amount'];

UPDATE booking_events
   SET data = pg_temp.ob_rekey(data, ARRAY['refundTotal', 'refundTotalCents'])
 WHERE kind = 'rooms_cancelled' AND data ? 'refundTotal';

UPDATE booking_events
   SET data = pg_temp.ob_rekey(data, ARRAY['roomPrice', 'roomPriceCents', 'touristTax', 'touristTaxCents'])
 WHERE kind = 'outside_refund_explained' AND data ?| ARRAY['roomPrice', 'touristTax'];

UPDATE booking_events
   SET data = pg_temp.ob_rekey(data, ARRAY['snapshotTotal', 'snapshotTotalCents'])
 WHERE kind = 'confirmed' AND data ? 'snapshotTotal';

-- The admin console keeps a deleted refund's whole row: its columns and breakdown move the same way.
UPDATE booking_events
   SET data = jsonb_set(
         data, '{refund}',
         CASE WHEN jsonb_typeof(data -> 'refund' -> 'breakdown') = 'object'
              THEN jsonb_set(
                     pg_temp.ob_rekey(data -> 'refund', ARRAY[
                       'accommodation_amount', 'accommodation_cents', 'tourist_tax_amount', 'tourist_tax_cents',
                       'amount', 'amount_cents']),
                     '{breakdown}', pg_temp.ob_refund_breakdown(data -> 'refund' -> 'breakdown'))
              ELSE pg_temp.ob_rekey(data -> 'refund', ARRAY[
                     'accommodation_amount', 'accommodation_cents', 'tourist_tax_amount', 'tourist_tax_cents',
                     'amount', 'amount_cents'])
         END)
 WHERE kind = 'forced_refund_deleted'
   AND jsonb_typeof(data -> 'refund') = 'object'
   AND (data -> 'refund' ?| ARRAY['accommodation_amount', 'tourist_tax_amount', 'amount']
        OR data -> 'refund' -> 'breakdown' ?| ARRAY['requested', 'capped']
        OR data -> 'refund' -> 'breakdown' -> 'refund' ?| ARRAY['accommodation', 'touristTax', 'total']);

-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS pg_temp.ob_nights_cents(jsonb);
DROP FUNCTION IF EXISTS pg_temp.ob_to_cents(text, text, text);
DROP FUNCTION IF EXISTS pg_temp.ob_refund_breakdown(jsonb);
DROP FUNCTION IF EXISTS pg_temp.ob_vat_split(jsonb);
DROP FUNCTION IF EXISTS pg_temp.ob_vat_night(jsonb);
DROP FUNCTION IF EXISTS pg_temp.ob_rekey_each(jsonb, text[]);
DROP FUNCTION IF EXISTS pg_temp.ob_rekey(jsonb, text[]);
DROP FUNCTION IF EXISTS pg_temp.ob_cents(jsonb);
DROP FUNCTION IF EXISTS pg_temp.ob_has_column(text, text);
