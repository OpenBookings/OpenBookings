-- Accounts: three hotel staff in one organisation, and two guests.
--
-- Everyone signs in with an email link. With EMAIL_TRANSPORT=console the link
-- is printed in the dev server's terminal instead of being emailed.
--
-- account_type decides the portal: 'business' signs in to the host dashboard,
-- 'private' to the guest site. One email cannot be both.

INSERT INTO "user" (id, name, email, "emailVerified", account_type, "createdAt", "updatedAt") VALUES
  ('seed-user-owner',   'Sanne de Vries', 'owner@openbookings.test',   true, 'business', now() - interval '120 days', now()),
  ('seed-user-admin',   'Lotte Jansen',   'admin@openbookings.test',   true, 'business', now() - interval '100 days', now()),
  ('seed-user-manager', 'Daan Bakker',    'manager@openbookings.test', true, 'business', now() - interval '90 days',  now()),
  ('seed-user-guest',   'Emma Visser',    'guest@openbookings.test',   true, 'private',  now() - interval '80 days',  now()),
  ('seed-user-guest2',  'Lukas Schneider','guest2@openbookings.test',  true, 'private',  now() - interval '60 days',  now())
ON CONFLICT (id) DO NOTHING;

-- Finished host onboarding, so the dashboard opens straight away.
INSERT INTO host_onboarding (user_id, completed_steps, onboarding_completed_at) VALUES
  ('seed-user-owner',   '{}', now() - interval '119 days'),
  ('seed-user-admin',   '{}', now() - interval '99 days'),
  ('seed-user-manager', '{}', now() - interval '89 days')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO guest_profile (user_id, phone, address_line1, postal_code, city, country) VALUES
  ('seed-user-guest',  '+31 6 00000001', 'Teststraat 1', '3511 AA', 'Utrecht', 'NL'),
  ('seed-user-guest2', '+49 30 0000002', 'Testweg 2',    '10115',   'Berlin',  'DE')
ON CONFLICT (user_id) DO NOTHING;

-- The organisation that owns the seeded hotels. A Dutch host: VAT is
-- domestic, so no VIES check is needed for it to be ready.
INSERT INTO "organization" (id, name, slug, "createdAt") VALUES
  ('seed-org-lantern', 'Lantern Hotels', 'lantern-hotels', now() - interval '120 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_profile (organization_id, legal_entity_name, kvk_number, vat_number, onboarding_completed_at) VALUES
  ('seed-org-lantern', 'Lantern Hotels B.V.', '00000001', 'NL000000001B01', now() - interval '119 days')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO billing_profiles
  (organization_id, legal_name, address_line1, postal_code, city, country_code, vat_id, kvk_number, billing_email)
VALUES
  ('seed-org-lantern', 'Lantern Hotels B.V.', 'Testgracht 1', '1015 AA', 'Amsterdam', 'NL',
   'NL000000001B01', '00000001', 'billing@openbookings.test')
ON CONFLICT (organization_id) DO NOTHING;

-- Roles: the owner and the admin see every property; the manager only the
-- ones listed in property_access (see 02_properties.sql).
INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES
  ('seed-member-owner',   'seed-org-lantern', 'seed-user-owner',   'owner',   now() - interval '120 days'),
  ('seed-member-admin',   'seed-org-lantern', 'seed-user-admin',   'admin',   now() - interval '100 days'),
  ('seed-member-manager', 'seed-org-lantern', 'seed-user-manager', 'manager', now() - interval '90 days')
ON CONFLICT (id) DO NOTHING;
