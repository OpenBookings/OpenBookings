-- 0034_booking_intents_dates_not_null — every booking intent is for a stay, so
-- its dates are required. 0033 left them nullable; nothing ever inserts an
-- intent without them (createBookingIntent always sets both).
--
-- Safe for the code running before this deploy: it never writes NULL dates.
-- Re-runnable: SET NOT NULL on a column that already is one is a no-op.
ALTER TABLE booking_intents ALTER COLUMN check_in_date SET NOT NULL;
ALTER TABLE booking_intents ALTER COLUMN check_out_date SET NOT NULL;
