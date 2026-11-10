-- Reviews and guest messages.
--
--   Booking …0005: published review (9/10) with a published host reply
--   Booking …0006: published review (7/10), waiting for a host reply
--   Booking …0001: an open message thread; the guest's last message is unread

INSERT INTO reviews
  (id, booking_id, property_id, guest_user_id, score, body, language, author_name, author_country,
   stay_month, room_label, status, submitted_via, published_at, created_at)
VALUES
  ('5eed6000-0000-4000-8000-000000000001', '5eed4000-0000-4000-8000-000000000005',
   '5eed1000-0000-4000-8000-000000000001', 'seed-user-guest', 9,
   'Lovely old house right on the canal. The family room was big enough for all four of us, and breakfast in the old kitchen was a highlight.',
   'en', 'Emma', 'NL', date_trunc('month', current_date - 40)::date, 'Family Room',
   'published', 'session', now() - interval '34 days', now() - interval '35 days'),
  ('5eed6000-0000-4000-8000-000000000002', '5eed4000-0000-4000-8000-000000000006',
   '5eed1000-0000-4000-8000-000000000002', 'seed-user-guest2', 7,
   'Great view of the Dom and a comfortable bed. The kitchenette was missing a kettle.',
   'en', 'Lukas', 'DE', date_trunc('month', current_date - 20)::date, 'Dom View Suite',
   'published', 'token', now() - interval '15 days', now() - interval '16 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO review_replies (id, review_id, author_role, author_user_id, body, status, published_at, created_at) VALUES
  ('5eed6100-0000-4000-8000-000000000001', '5eed6000-0000-4000-8000-000000000001', 'host', 'seed-user-owner',
   'Thank you, Emma! We''re glad the kids liked the attic beds. Hope to see you all again.',
   'published', now() - interval '33 days', now() - interval '33 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO review_invitations (booking_id, sent_at, claimed_at, attempts) VALUES
  ('5eed4000-0000-4000-8000-000000000005', now() - interval '36 days', now() - interval '35 days', 1),
  ('5eed4000-0000-4000-8000-000000000006', now() - interval '17 days', now() - interval '16 days', 1)
ON CONFLICT (booking_id) DO NOTHING;

INSERT INTO message_threads (id, booking_id, property_id, host_id, guest_id, status, created_at, updated_at) VALUES
  ('5eed7000-0000-4000-8000-000000000001', '5eed4000-0000-4000-8000-000000000001',
   '5eed1000-0000-4000-8000-000000000001', 'seed-user-owner', 'seed-user-guest', 'open',
   now() - interval '9 days', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, thread_id, sender_id, sender_role, body, read_at, created_at) VALUES
  ('5eed8000-0000-4000-8000-000000000001', '5eed7000-0000-4000-8000-000000000001', 'seed-user-guest', 'guest',
   'Hi! Is there somewhere we can leave our bags if we arrive early?', now() - interval '9 days', now() - interval '9 days'),
  ('5eed8000-0000-4000-8000-000000000002', '5eed7000-0000-4000-8000-000000000001', 'seed-user-owner', 'host',
   'Of course. Reception is open all day, and you can leave your bags with us from 9:00.', now() - interval '8 days', now() - interval '8 days'),
  ('5eed8000-0000-4000-8000-000000000003', '5eed7000-0000-4000-8000-000000000001', 'seed-user-guest', 'guest',
   'Perfect, thank you. Could we have a room on a high floor?', NULL, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;
