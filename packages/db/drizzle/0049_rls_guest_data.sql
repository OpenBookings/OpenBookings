-- 0049_rls_guest_data — database roles and row-level security for guest data.
--
-- Until now tenant isolation lived only in @openbookings/authz: every app
-- connects as neondb_owner, which bypasses RLS, so one query that forgot its
-- ownership check would hand any signed-in host another host's guests. This
-- migration builds the second layer. It changes nothing for the apps yet:
-- they still connect as neondb_owner, and a table's owner skips its policies.
-- The policies start to bite when an app connects as ob_web or ob_business
-- (see packages/db/README.md, "Authorization").
--
-- Roles (created NOLOGIN; LOGIN and a password are set by hand, never in git):
--
--   ob_app       group role for app code. No BYPASSRLS. Policies target it.
--   ob_web       guest site; member of ob_app.
--   ob_business  host dashboard; member of ob_app.
--   ob_auth      Better Auth's pool and its hooks. BYPASSRLS: library code,
--                no hand-written queries keyed on request ids.
--   ob_system    Stripe webhooks, crons, invoice job, support bot, mail.
--                BYPASSRLS, on purpose and explicitly chosen in code.
--
-- Who the request is for: each app request runs in a transaction that first
-- does `SELECT set_config('app.user_id', <session user id>, true)` (and
-- `set_config('app.testing', 'on', true)` in testing mode). The `true` makes
-- it transaction-local, which matters: the Neon pooler hands one server
-- connection to many clients. With no user set, every policy below matches
-- nothing, so a query that forgets the wrapper returns no rows instead of
-- every row.
--
-- The host side of every policy is app.readable_property_ids(), which mirrors
-- propertyReadAccessSql in packages/authz: every org role reads, the
-- property-scoped roles (manager, reservations, frontdesk) need a
-- property_access row, legacy owner_user_id counts only for pre-org
-- properties, and a demo-org membership counts only in testing mode. If you
-- change the roles in packages/authz/src/permissions.ts, change it here too;
-- packages/db/src/rls.db.test.ts checks the two agree.
--
-- Policies are deliberately coarser than the app's checks: they keep hosts
-- and guests inside their own data (cross-tenant), and leave per-role rules
-- (who may cancel, refund, reply) to authz.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Created bare if missing, then given their attributes and memberships
  -- every time: CI rebuilds these roles from a schema dump, which names them
  -- but carries neither.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_app') THEN CREATE ROLE ob_app; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_web') THEN CREATE ROLE ob_web; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_business') THEN CREATE ROLE ob_business; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_auth') THEN CREATE ROLE ob_auth; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_system') THEN CREATE ROLE ob_system; END IF;
  -- LOGIN is never set here: it comes with a password, by hand.
  ALTER ROLE ob_app NOBYPASSRLS;
  ALTER ROLE ob_web NOBYPASSRLS;
  ALTER ROLE ob_business NOBYPASSRLS;
  ALTER ROLE ob_auth BYPASSRLS;
  ALTER ROLE ob_system BYPASSRLS;
  GRANT ob_app TO ob_web, ob_business;
  -- Whoever runs migrations may SET ROLE to the app roles, so tests can check
  -- the policies as the apps will meet them. SET only, no INHERIT: the owner
  -- gains nothing it did not have.
  EXECUTE format('GRANT ob_web, ob_business TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END
$$;

-- ---------------------------------------------------------------------------
-- Request context and access helpers
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

-- The signed-in user for this transaction, or NULL.
CREATE OR REPLACE FUNCTION app.user_id() RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- Every property the current user may read as a host. SECURITY DEFINER so it
-- reads member/property_access whatever the caller's grants. Policies call it
-- as `(SELECT app.readable_property_ids())`, which Postgres evaluates once per
-- statement rather than once per row.
CREATE OR REPLACE FUNCTION app.readable_property_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(array_agg(p.id), '{}'::uuid[])
  FROM properties p
  WHERE app.user_id() IS NOT NULL
    AND (
      (p.organization_id IS NULL AND p.owner_user_id = app.user_id())
      OR EXISTS (
        SELECT 1 FROM "member" m
        WHERE m."organizationId" = p.organization_id
          AND m."userId" = app.user_id()
          AND (current_setting('app.testing', true) = 'on' OR m."organizationId" <> 'demo-organisation')
          AND (
            m.role IN ('owner', 'admin', 'finance')
            OR (m.role IN ('manager', 'reservations', 'frontdesk') AND EXISTS (
              SELECT 1 FROM property_access pa
              WHERE pa.member_id = m.id AND pa.property_id = p.id
            ))
          )
      )
    )
$$;

-- Whether the current user may see this user's name and email: themselves,
-- someone in an organization they belong to, a guest who booked or wrote to
-- a property they read, the host of a thread they are the guest on, or the
-- person who invited them.
CREATE OR REPLACE FUNCTION app.can_see_user(p_user_id text, p_readable uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app.user_id() IS NOT NULL AND (
    p_user_id = app.user_id()
    OR EXISTS (
      SELECT 1 FROM "member" mine
      JOIN "member" theirs ON theirs."organizationId" = mine."organizationId"
      WHERE mine."userId" = app.user_id() AND theirs."userId" = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.user_id = p_user_id AND b.hotel_id = ANY (p_readable)
    )
    OR EXISTS (
      SELECT 1 FROM message_threads t
      WHERE (t.guest_id = p_user_id AND t.property_id = ANY (p_readable))
         OR (t.host_id = p_user_id AND t.guest_id = app.user_id())
    )
    OR EXISTS (
      SELECT 1 FROM invitation i
      JOIN "user" me ON me.id = app.user_id()
      WHERE i."inviterId" = p_user_id AND lower(i.email) = lower(me.email)
    )
  )
$$;

-- Units of each room taken per night, by paid bookings and by open checkout
-- holds: counts only, no guest data. Availability needs every guest's rooms,
-- which RLS rightly hides from a guest, so the guest site reads them through
-- this instead of joining reservations/booking_intent_rooms itself. Same
-- rules as the `booked` and `held` CTEs in packages/db/src/availability.ts;
-- nights are [p_from, p_to).
CREATE OR REPLACE FUNCTION app.room_units_taken(
  p_room_ids uuid[], p_from date, p_to date, p_now timestamptz, p_exclude_intent uuid
) RETURNS TABLE (taken_room_id uuid, night date, booked_units int, held_units int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH nights AS (
    SELECT generate_series(p_from, p_to - 1, INTERVAL '1 day')::date AS d
  ),
  booked AS (
    SELECT res.room_id, n.d, COUNT(*)::int AS units
    FROM reservations res
    JOIN bookings b ON b.id = res.booking_id
    JOIN nights n ON n.d >= b.check_in_date
                 AND n.d < LEAST(b.check_out_date, COALESCE(b.departed_early_on + 1, b.check_out_date))
    WHERE res.room_id = ANY (p_room_ids)
      AND b.status::text IN ('confirmed', 'checked_in', 'completed')
      AND res.cancelled_at IS NULL
    GROUP BY res.room_id, n.d
  ),
  held AS (
    SELECT bir.room_id, n.d, COUNT(*)::int AS units
    FROM booking_intent_rooms bir
    JOIN booking_intents bi ON bi.id = bir.intent_id
    JOIN nights n ON n.d >= bi.check_in_date AND n.d < bi.check_out_date
    WHERE bir.room_id = ANY (p_room_ids)
      AND bi.status = 'open'
      AND bi.hold_expires_at > p_now
      AND bi.id IS DISTINCT FROM p_exclude_intent
    GROUP BY bir.room_id, n.d
  )
  SELECT coalesce(bk.room_id, h.room_id), coalesce(bk.d, h.d),
         coalesce(bk.units, 0), coalesce(h.units, 0)
  FROM booked bk
  FULL JOIN held h ON h.room_id = bk.room_id AND h.d = bk.d
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO ob_app, ob_auth, ob_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ob_app, ob_auth, ob_system;

-- ---------------------------------------------------------------------------
-- Table privileges. Explicit, not default privileges: a table added later is
-- unreachable for the apps until its migration grants it, which fails loudly
-- instead of quietly exposing a new table with no policies.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO ob_app, ob_auth, ob_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ob_app, ob_auth, ob_system;

-- ob_system: everything but the migration ledger.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ob_system;
REVOKE ALL ON "__ob_migrations" FROM ob_system;

-- ob_auth: everything but the ledger and the invoicing tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ob_auth;
REVOKE ALL ON "__ob_migrations", invoice_runs, invoice_sequences, invoices, commission_entries
  FROM ob_auth;
REVOKE ALL ON v_vat_return_quarter, v_icp_listing_quarter, v_dac7_fees_quarter, v_returned_payments_quarter
  FROM ob_auth;

-- ob_app: read and write the product tables, then take back what app code
-- has no business touching.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ob_app;
REVOKE ALL ON
  "__ob_migrations",
  processed_events,          -- webhook dedupe: ob_system
  support_context_cache,     -- support bot: ob_system
  v_vat_return_quarter, v_icp_listing_quarter, v_dac7_fees_quarter, v_returned_payments_quarter,
  "user", account, session, passkey, "twoFactor", verification
FROM ob_app;

-- Written by the invoice job and the Stripe webhook (ob_system); the
-- dashboard only shows them.
REVOKE INSERT, UPDATE, DELETE ON invoices, invoice_runs, invoice_sequences, commission_entries FROM ob_app;

-- Append-only records.
REVOKE UPDATE, DELETE ON audit_log, booking_events, org_consent FROM ob_app;

-- Login tables: only the columns app code reads (data export, team security
-- badges, org switch). No password hashes, tokens or secrets.
GRANT SELECT (id, name, email, "emailVerified", image, "createdAt", "updatedAt",
              account_type, role, "twoFactorEnabled") ON "user" TO ob_app;
GRANT SELECT ("userId", "providerId", "createdAt") ON account TO ob_app;
GRANT SELECT ("userId", name, "deviceType", "backedUp", "createdAt") ON passkey TO ob_app;
GRANT SELECT (id, "userId", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent",
              "activeOrganizationId") ON session TO ob_app;
GRANT UPDATE ("activeOrganizationId") ON session TO ob_app;

-- ---------------------------------------------------------------------------
-- Row-level security. ENABLE, not FORCE: the owner (migrations, and the apps
-- until they switch roles) is not subject to it.
-- ---------------------------------------------------------------------------

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_intent_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_intent_payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_room_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkey ENABLE ROW LEVEL SECURITY;

-- Bookings: the guest's own, or any at a property the host reads.
DROP POLICY IF EXISTS ob_app_party ON bookings;
CREATE POLICY ob_app_party ON bookings FOR ALL TO ob_app
  USING (user_id = app.user_id() OR hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (user_id = app.user_id() OR hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

-- Rows hanging off a booking follow it: the subquery on bookings is itself
-- filtered by the bookings policy above.
DROP POLICY IF EXISTS ob_app_party ON reservations;
CREATE POLICY ob_app_party ON reservations FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = reservations.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = reservations.booking_id));

DROP POLICY IF EXISTS ob_app_party ON booking_events;
CREATE POLICY ob_app_party ON booking_events FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_events.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_events.booking_id));

DROP POLICY IF EXISTS ob_app_party ON refunds;
CREATE POLICY ob_app_party ON refunds FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = refunds.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = refunds.booking_id));

DROP POLICY IF EXISTS ob_app_party ON transactions;
CREATE POLICY ob_app_party ON transactions FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = transactions.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = transactions.booking_id));

DROP POLICY IF EXISTS ob_app_party ON review_invitations;
CREATE POLICY ob_app_party ON review_invitations FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = review_invitations.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = review_invitations.booking_id));

-- Checkout holds: the guest's own, or any at a property the host reads.
DROP POLICY IF EXISTS ob_app_party ON booking_intents;
CREATE POLICY ob_app_party ON booking_intents FOR ALL TO ob_app
  USING (user_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (user_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

DROP POLICY IF EXISTS ob_app_party ON booking_intent_rooms;
CREATE POLICY ob_app_party ON booking_intent_rooms FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM booking_intents bi WHERE bi.id = booking_intent_rooms.intent_id))
  WITH CHECK (EXISTS (SELECT 1 FROM booking_intents bi WHERE bi.id = booking_intent_rooms.intent_id));

DROP POLICY IF EXISTS ob_app_party ON booking_intent_payment_sessions;
CREATE POLICY ob_app_party ON booking_intent_payment_sessions FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM booking_intents bi WHERE bi.id = booking_intent_payment_sessions.intent_id))
  WITH CHECK (EXISTS (SELECT 1 FROM booking_intents bi WHERE bi.id = booking_intent_payment_sessions.intent_id));

-- Guest contact details: the guest writes their own; a host reads them only
-- for a guest who booked at one of their properties.
DROP POLICY IF EXISTS ob_app_own ON guest_profile;
CREATE POLICY ob_app_own ON guest_profile FOR ALL TO ob_app
  USING (user_id = app.user_id())
  WITH CHECK (user_id = app.user_id());
DROP POLICY IF EXISTS ob_app_host_read ON guest_profile;
CREATE POLICY ob_app_host_read ON guest_profile FOR SELECT TO ob_app
  USING (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.user_id = guest_profile.user_id
      AND b.hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[])
  ));

-- Messages: the thread's guest, or anyone who reads the property.
DROP POLICY IF EXISTS ob_app_party ON message_threads;
CREATE POLICY ob_app_party ON message_threads FOR ALL TO ob_app
  USING (guest_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (guest_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

DROP POLICY IF EXISTS ob_app_party ON messages;
CREATE POLICY ob_app_party ON messages FOR ALL TO ob_app
  USING (EXISTS (SELECT 1 FROM message_threads t WHERE t.id = messages.thread_id))
  WITH CHECK (EXISTS (SELECT 1 FROM message_threads t WHERE t.id = messages.thread_id));

-- Reviews: published ones are public (property pages show them to anyone);
-- the rest belong to the guest who wrote them and the property's hosts.
DROP POLICY IF EXISTS ob_app_public_read ON reviews;
CREATE POLICY ob_app_public_read ON reviews FOR SELECT TO ob_app
  USING (status = 'published' AND deleted_at IS NULL);
DROP POLICY IF EXISTS ob_app_party ON reviews;
CREATE POLICY ob_app_party ON reviews FOR ALL TO ob_app
  USING (guest_user_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (guest_user_id = app.user_id() OR property_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

DROP POLICY IF EXISTS ob_app_public_read ON review_replies;
CREATE POLICY ob_app_public_read ON review_replies FOR SELECT TO ob_app
  USING (status = 'published' AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_replies.review_id));
DROP POLICY IF EXISTS ob_app_party ON review_replies;
CREATE POLICY ob_app_party ON review_replies FOR ALL TO ob_app
  USING (EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_replies.review_id
      AND (r.guest_user_id = app.user_id() OR r.property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_replies.review_id
      AND (r.guest_user_id = app.user_id() OR r.property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  ));

-- One user's own rows.
DROP POLICY IF EXISTS ob_app_own ON guest_room_likes;
CREATE POLICY ob_app_own ON guest_room_likes FOR ALL TO ob_app
  USING (user_id = app.user_id()) WITH CHECK (user_id = app.user_id());

DROP POLICY IF EXISTS ob_app_own ON host_onboarding;
CREATE POLICY ob_app_own ON host_onboarding FOR ALL TO ob_app
  USING (user_id = app.user_id()) WITH CHECK (user_id = app.user_id());

-- Consent is recorded before sign-in too (user_id NULL), keyed by the
-- banner's consent id.
DROP POLICY IF EXISTS ob_app_own ON consent_log;
CREATE POLICY ob_app_own ON consent_log FOR ALL TO ob_app
  USING (user_id IS NULL OR user_id = app.user_id())
  WITH CHECK (user_id IS NULL OR user_id = app.user_id());

-- Login tables (column grants above already hide the secrets).
DROP POLICY IF EXISTS ob_app_visible ON "user";
CREATE POLICY ob_app_visible ON "user" FOR SELECT TO ob_app
  USING (app.can_see_user(id, (SELECT app.readable_property_ids())));

DROP POLICY IF EXISTS ob_app_own ON account;
CREATE POLICY ob_app_own ON account FOR SELECT TO ob_app
  USING ("userId" = app.user_id());

DROP POLICY IF EXISTS ob_app_own ON passkey;
CREATE POLICY ob_app_own ON passkey FOR SELECT TO ob_app
  USING ("userId" = app.user_id());

DROP POLICY IF EXISTS ob_app_own ON session;
CREATE POLICY ob_app_own ON session FOR ALL TO ob_app
  USING ("userId" = app.user_id()) WITH CHECK ("userId" = app.user_id());
