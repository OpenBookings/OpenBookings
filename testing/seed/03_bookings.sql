-- Bookings in every state the apps handle, with dates relative to today so
-- "upcoming" stays upcoming whenever the seed is loaded.
--
--   id …0001  upcoming, Flex, refundable       Emma    Canal Lantern  Classic Double        +14 → +17
--   id …0002  upcoming, non-refundable         Emma    Canal Lantern  Classic Double (NR)   +30 → +32
--   id …0003  upcoming, two rooms, Standard    Lukas   Dom Garden     2 × Garden Studio     +45 → +48
--   id …0004  in house (checked in)            Lukas   Canal Lantern  Canal View Double     −1 → +2
--   id …0005  stayed, reviewed, host replied   Emma    Canal Lantern  Family Room           −40 → −37
--   id …0006  stayed, reviewed, no reply yet   Lukas   Dom Garden     Dom View Suite        −20 → −18
--   id …0007  stayed, checked out yesterday    Emma    Dom Garden     Garden Studio         −3 → −1
--   id …0008  cancelled by the guest           Emma    Canal Lantern  Classic Double        +20 → +22
--   id …0009  no-show                          Lukas   Dom Garden     Garden Studio         −10 → −8
--
-- Only the basics are written here. testing/scripts/setup.ts then runs each
-- booking through the same policy code checkout uses (cancellation windows,
-- per-night prices, tourist tax) and fills in the totals and commission.

INSERT INTO bookings
  (id, hotel_id, user_id, check_in_date, check_out_date, status, total_amount, currency,
   stripe_payment_intent_id, guest_notes, created_at, confirmed_at,
   cancelled_at, cancellation_reason, no_show_reported_at)
VALUES
  ('5eed4000-0000-4000-8000-000000000001', '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest',
   current_date + 14, current_date + 17, 'confirmed', 0, 'EUR', 'pi_seed_0001',
   'We arrive by train around 18:00.', now() - interval '10 days', now() - interval '10 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000002', '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest',
   current_date + 30, current_date + 32, 'confirmed', 0, 'EUR', 'pi_seed_0002',
   NULL, now() - interval '3 days', now() - interval '3 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000003', '5eed1000-0000-4000-8000-000000000002', 'seed-user-guest2',
   current_date + 45, current_date + 48, 'confirmed', 0, 'EUR', 'pi_seed_0003',
   'Two colleagues, separate rooms please.', now() - interval '6 days', now() - interval '6 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000004', '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest2',
   current_date - 1, current_date + 2, 'checked_in', 0, 'EUR', 'pi_seed_0004',
   NULL, now() - interval '25 days', now() - interval '25 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000005', '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest',
   current_date - 40, current_date - 37, 'completed', 0, 'EUR', 'pi_seed_0005',
   'Travelling with two children.', now() - interval '70 days', now() - interval '70 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000006', '5eed1000-0000-4000-8000-000000000002', 'seed-user-guest2',
   current_date - 20, current_date - 18, 'completed', 0, 'EUR', 'pi_seed_0006',
   NULL, now() - interval '50 days', now() - interval '50 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000007', '5eed1000-0000-4000-8000-000000000002', 'seed-user-guest',
   current_date - 3, current_date - 1, 'completed', 0, 'EUR', 'pi_seed_0007',
   NULL, now() - interval '30 days', now() - interval '30 days', NULL, NULL, NULL),
  ('5eed4000-0000-4000-8000-000000000008', '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest',
   current_date + 20, current_date + 22, 'cancelled', 0, 'EUR', 'pi_seed_0008',
   NULL, now() - interval '15 days', now() - interval '15 days', now() - interval '2 days', 'Plans changed', NULL),
  ('5eed4000-0000-4000-8000-000000000009', '5eed1000-0000-4000-8000-000000000002', 'seed-user-guest2',
   current_date - 10, current_date - 8, 'no_show', 0, 'EUR', 'pi_seed_0009',
   NULL, now() - interval '40 days', now() - interval '40 days', NULL, NULL, now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reservations
  (id, booking_id, room_id, rate_plan_id, adults, children, total_nights, price_per_night, total_amount, cancelled_at)
VALUES
  ('5eed5000-0000-4000-8000-000000000001', '5eed4000-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-000000000001', '5eed3000-0000-4000-8000-000000000001', 2, 0, 3, 165, 495, NULL),
  ('5eed5000-0000-4000-8000-000000000002', '5eed4000-0000-4000-8000-000000000002', '5eed2000-0000-4000-8000-000000000001', '5eed3000-0000-4000-8000-000000000002', 2, 0, 2, 149, 298, NULL),
  ('5eed5000-0000-4000-8000-000000000003', '5eed4000-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-000000000004', '5eed3000-0000-4000-8000-000000000005', 1, 0, 3, 145, 435, NULL),
  ('5eed5000-0000-4000-8000-000000000004', '5eed4000-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-000000000004', '5eed3000-0000-4000-8000-000000000005', 1, 0, 3, 145, 435, NULL),
  ('5eed5000-0000-4000-8000-000000000005', '5eed4000-0000-4000-8000-000000000004', '5eed2000-0000-4000-8000-000000000002', '5eed3000-0000-4000-8000-000000000003', 2, 0, 3, 215, 645, NULL),
  ('5eed5000-0000-4000-8000-000000000006', '5eed4000-0000-4000-8000-000000000005', '5eed2000-0000-4000-8000-000000000003', '5eed3000-0000-4000-8000-000000000004', 2, 2, 3, 260, 780, NULL),
  ('5eed5000-0000-4000-8000-000000000007', '5eed4000-0000-4000-8000-000000000006', '5eed2000-0000-4000-8000-000000000005', '5eed3000-0000-4000-8000-000000000006', 2, 0, 2, 230, 460, NULL),
  ('5eed5000-0000-4000-8000-000000000008', '5eed4000-0000-4000-8000-000000000007', '5eed2000-0000-4000-8000-000000000004', '5eed3000-0000-4000-8000-000000000005', 2, 0, 2, 145, 290, NULL),
  ('5eed5000-0000-4000-8000-000000000009', '5eed4000-0000-4000-8000-000000000008', '5eed2000-0000-4000-8000-000000000001', '5eed3000-0000-4000-8000-000000000001', 2, 0, 2, 165, 330, now() - interval '2 days'),
  ('5eed5000-0000-4000-8000-000000000010', '5eed4000-0000-4000-8000-000000000009', '5eed2000-0000-4000-8000-000000000004', '5eed3000-0000-4000-8000-000000000005', 1, 0, 2, 145, 290, NULL)
ON CONFLICT (id) DO NOTHING;
