-- Hotels, rooms, rates and availability rules.
--
--   Canal Lantern Hotel  Amsterdam  live    Flex tier (free cancellation until 24 h before)
--   Dom Garden Suites    Utrecht    live    Standard tier (free cancellation until 7 days before)
--   Singel Loft House    Amsterdam  draft   not published, legal details missing
--
-- Money is in whole euros and tax-inclusive, like every rate in the schema.
-- Stripe accounts are placeholders; testing/scripts/setup.ts puts
-- STRIPE_CONNECT_ACCOUNT_ID on the Amsterdam hotel when it is set, so that
-- hotel can take a test-mode payment.
-- Images are the public backdrops the demo hotels use.

INSERT INTO properties
  (id, name, slug, subtitle, address_line_1, postal_code, city, country, timezone, location,
   check_in_time, check_in_until, check_out_time, is_active, cancellation_tier,
   organization_id, owner_user_id, stripe_account_id, created_at)
VALUES
  ('5eed1000-0000-4000-8000-000000000001', 'Canal Lantern Hotel', 'canal-lantern-hotel',
   'A canal house hotel in the Jordaan', 'Testgracht 1', '1015 AA', 'Amsterdam', 'NL', 'Europe/Amsterdam',
   ST_SetSRID(ST_MakePoint(4.8840, 52.3738), 4326)::geography,
   '15:00', '23:00', '11:00', true, 'flex',
   'seed-org-lantern', 'seed-user-owner', 'acct_seed_canal_lantern', now() - interval '118 days'),
  ('5eed1000-0000-4000-8000-000000000002', 'Dom Garden Suites', 'dom-garden-suites',
   'Suites in the shadow of the Dom tower', 'Testplein 2', '3512 AA', 'Utrecht', 'NL', 'Europe/Amsterdam',
   ST_SetSRID(ST_MakePoint(5.1214, 52.0907), 4326)::geography,
   '14:00', '22:00', '11:00', true, 'standard',
   'seed-org-lantern', 'seed-user-owner', 'acct_seed_dom_garden', now() - interval '110 days'),
  ('5eed1000-0000-4000-8000-000000000003', 'Singel Loft House', 'singel-loft-house',
   NULL, 'Testsingel 3', '1012 AA', 'Amsterdam', 'NL', 'Europe/Amsterdam',
   ST_SetSRID(ST_MakePoint(4.8900, 52.3700), 4326)::geography,
   '15:00', NULL, '10:00', false, 'standard',
   'seed-org-lantern', 'seed-user-owner', NULL, now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_content
  (property_id, overview_headline, overview_description, location_about, reception_24h,
   children_welcome, pets_allowed, legal_company_name, vat_number, contact_email, contact_phone)
VALUES
  ('5eed1000-0000-4000-8000-000000000001',
   'Sleep on the canal',
   'Twenty rooms in two seventeenth-century canal houses, joined by a courtyard garden. Breakfast is served in the old kitchen until noon.',
   'In the Jordaan, a short walk from the Anne Frank House and the Noordermarkt.',
   true, true, false,
   'Lantern Hotels B.V.', 'NL000000001B01', 'canal@openbookings.test', '+31 20 000 0001'),
  ('5eed1000-0000-4000-8000-000000000002',
   'Suites with a garden view',
   'Eight suites around a walled garden, each with a kitchenette. Quiet, five minutes from Utrecht Centraal.',
   'On a square behind the Dom tower, between the canals and the station.',
   false, true, true,
   'Lantern Hotels B.V.', 'NL000000001B01', 'dom@openbookings.test', '+31 30 000 0002'),
  -- The draft hotel has no legal details yet: it shows up as "not ready".
  ('5eed1000-0000-4000-8000-000000000003',
   NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, NULL)
ON CONFLICT (property_id) DO NOTHING;

INSERT INTO property_images (property_id, url, "group", sort_order, alt_text) VALUES
  ('5eed1000-0000-4000-8000-000000000001', 'https://cdn.openbookings.co/Public/backgrounds/Netherlands-Amsterdam.jpg', 'hero-image', 0, 'Canal Lantern Hotel'),
  ('5eed1000-0000-4000-8000-000000000001', 'https://cdn.openbookings.co/Public/backgrounds/France-Paris.jpg',         'gallery',    1, 'Canal Lantern Hotel'),
  ('5eed1000-0000-4000-8000-000000000001', 'https://cdn.openbookings.co/Public/backgrounds/Italy-Rome.jpg',           'gallery',    2, 'Canal Lantern Hotel'),
  ('5eed1000-0000-4000-8000-000000000001', 'https://cdn.openbookings.co/Public/backgrounds/Hungary-Budapest.jpg',     'gallery',    3, 'Canal Lantern Hotel'),
  ('5eed1000-0000-4000-8000-000000000002', 'https://cdn.openbookings.co/Public/backgrounds/Switzerland-Luzern.jpg',   'hero-image', 0, 'Dom Garden Suites'),
  ('5eed1000-0000-4000-8000-000000000002', 'https://cdn.openbookings.co/Public/backgrounds/Italy-Tuscany.jpg',        'gallery',    1, 'Dom Garden Suites'),
  ('5eed1000-0000-4000-8000-000000000002', 'https://cdn.openbookings.co/Public/backgrounds/Norway-Bergen.jpg',        'gallery',    2, 'Dom Garden Suites'),
  ('5eed1000-0000-4000-8000-000000000002', 'https://cdn.openbookings.co/Public/backgrounds/Italy-Lake-Como.jpg',      'gallery',    3, 'Dom Garden Suites');

-- The manager may only work on the Amsterdam hotel.
INSERT INTO property_access (member_id, property_id) VALUES
  ('seed-member-manager', '5eed1000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

-- Rooms. total_units is how many identical rooms of the type exist.
INSERT INTO rooms
  (id, property_id, name, description, room_type, bed_type, size_sqm,
   max_adults, max_children, base_occupancy, total_units, sort_order, is_active)
VALUES
  ('5eed2000-0000-4000-8000-000000000001', '5eed1000-0000-4000-8000-000000000001',
   'Classic Double', 'A quiet room on the courtyard side.', 'double', 'Queen bed', 18, 2, 1, 2, 8, 0, true),
  ('5eed2000-0000-4000-8000-000000000002', '5eed1000-0000-4000-8000-000000000001',
   'Canal View Double', 'Two tall windows over the canal.', 'double', 'King bed', 24, 2, 1, 2, 4, 1, true),
  ('5eed2000-0000-4000-8000-000000000003', '5eed1000-0000-4000-8000-000000000001',
   'Family Room', 'A double bed and two single beds under the eaves.', 'family', 'King bed and two singles', 32, 2, 2, 4, 2, 2, true),
  ('5eed2000-0000-4000-8000-000000000004', '5eed1000-0000-4000-8000-000000000002',
   'Garden Studio', 'A studio with a kitchenette, opening onto the garden.', 'studio', 'Queen bed', 28, 2, 0, 2, 6, 0, true),
  ('5eed2000-0000-4000-8000-000000000005', '5eed1000-0000-4000-8000-000000000002',
   'Dom View Suite', 'A separate living room with a view of the Dom tower.', 'suite', 'King bed', 45, 3, 1, 2, 2, 1, true),
  ('5eed2000-0000-4000-8000-000000000006', '5eed1000-0000-4000-8000-000000000003',
   'Loft', 'Not finished yet.', 'double', 'Queen bed', 30, 2, 0, 2, 3, 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_images (room_id, url, sort_order, alt_text) VALUES
  ('5eed2000-0000-4000-8000-000000000001', 'https://cdn.openbookings.co/Public/backgrounds/Poland-Warsaw.jpg',        0, 'Classic Double'),
  ('5eed2000-0000-4000-8000-000000000002', 'https://cdn.openbookings.co/Public/backgrounds/Netherlands-Amsterdam.jpg', 0, 'Canal View Double'),
  ('5eed2000-0000-4000-8000-000000000003', 'https://cdn.openbookings.co/Public/backgrounds/Ireland-Saltee-Islands.jpg', 0, 'Family Room'),
  ('5eed2000-0000-4000-8000-000000000004', 'https://cdn.openbookings.co/Public/backgrounds/Greece-Milos.jpg',         0, 'Garden Studio'),
  ('5eed2000-0000-4000-8000-000000000005', 'https://cdn.openbookings.co/Public/backgrounds/Slovenia-Plitvice.jpg',    0, 'Dom View Suite');

-- Rate plans. "Non-refundable" ignores the property's tier.
INSERT INTO rate_plans
  (id, room_id, name, description, bar, currency, is_refundable, min_stay,
   includes_breakfast, sort_order, is_active)
VALUES
  ('5eed3000-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-000000000001', 'Flexible',        NULL,                    165, 'EUR', true,  1, false, 0, true),
  ('5eed3000-0000-4000-8000-000000000002', '5eed2000-0000-4000-8000-000000000001', 'Non-refundable',  'Pay now, save 10%',     149, 'EUR', false, 1, false, 1, true),
  ('5eed3000-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-000000000002', 'Flexible',        NULL,                    215, 'EUR', true,  1, false, 0, true),
  ('5eed3000-0000-4000-8000-000000000004', '5eed2000-0000-4000-8000-000000000003', 'Bed and breakfast','Breakfast for everyone', 260, 'EUR', true,  2, true,  0, true),
  ('5eed3000-0000-4000-8000-000000000005', '5eed2000-0000-4000-8000-000000000004', 'Flexible',        NULL,                    145, 'EUR', true,  1, false, 0, true),
  ('5eed3000-0000-4000-8000-000000000006', '5eed2000-0000-4000-8000-000000000005', 'Flexible',        NULL,                    230, 'EUR', true,  1, false, 0, true),
  ('5eed3000-0000-4000-8000-000000000007', '5eed2000-0000-4000-8000-000000000006', 'Flexible',        NULL,                    180, 'EUR', true,  1, false, 0, true)
ON CONFLICT (id) DO NOTHING;

-- Fridays and Saturdays cost €30 more at the Amsterdam hotel's Classic Double.
INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order) VALUES
  ('5eed3000-0000-4000-8000-000000000001', 'day_of_week', '{"days_of_week": [5, 6]}', 'flat', 30, true, 0);

-- Rules on the grid, relative to today so they never run out:
--   * the Dom View Suite is closed for three nights two months out (maintenance),
--   * the Garden Studio needs a 3-night minimum over a week a month out.
INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed, min_stay, note, created_by) VALUES
  ('5eed3000-0000-4000-8000-000000000006', current_date + 60, current_date + 62, true, NULL, 'Painting the suite', 'seed-user-owner'),
  ('5eed3000-0000-4000-8000-000000000005', current_date + 28, current_date + 34, false, 3,  'Event week',         'seed-user-owner');

-- One Canal View Double is out of service next week.
INSERT INTO room_inventory (room_id, date, blocked_rooms, note, updated_by)
SELECT '5eed2000-0000-4000-8000-000000000002', d::date, 1, 'Leaking radiator', 'seed-user-manager'
FROM generate_series(current_date + 7, current_date + 10, interval '1 day') AS d
ON CONFLICT (room_id, date) DO NOTHING;

-- Tourist tax. Amsterdam: 12.5% of the room price before 9% VAT.
-- Utrecht: a fixed amount per person per night. (Illustrative rates.)
INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt, max_nights, created_by) VALUES
  ('5eed1000-0000-4000-8000-000000000001', '2000-01-01',
   '[{"kind": "percent", "amount": 12.5, "perPerson": false, "perNight": false, "perRoom": false, "vatIncludedPercent": 9}]',
   false, NULL, 'seed-user-owner'),
  ('5eed1000-0000-4000-8000-000000000002', '2000-01-01',
   '[{"kind": "fixed", "amount": 3.5, "perPerson": true, "perNight": true, "perRoom": false}]',
   true, NULL, 'seed-user-owner');
