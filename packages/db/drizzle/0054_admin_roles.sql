-- 0054_admin_roles — least-privilege database roles for the admin console.
--
-- apps/admin is dev-only and runs on the owner's laptop. To look at
-- production (the Flagged payments page, a booking) it used to need the apps'
-- full-access connection string: a bug or a misclick could change anything,
-- and a secret that powerful sat on a laptop. It now connects with two roles
-- of its own (see apps/admin/lib/db.ts):
--
--   ob_admin_read   every page and data loader. SELECT only, on what the
--                   pages show.
--   ob_admin_write  the server actions only: the booking lifecycle (cancel,
--                   check-in, no-show, early departure, goodwill and retried
--                   refunds), the booking emails those send, the forced edits
--                   and resolving a flagged payment (with the host's split of
--                   an outside refund, 0053). Only the columns those change,
--                   and SELECT where they read.
--
-- Neither can run DDL, owns anything, or reaches a table not listed here.
-- Login tables: id, name and email of "user" only (no password hashes,
-- tokens or 2FA secrets; account/session/passkey/twoFactor not at all).
--
-- BYPASSRLS, like ob_system and ob_auth in 0049: staff legitimately see every
-- host's bookings, and the 0049 policies target ob_app only, so without it a
-- row-level-secured table would show the admin nothing. BYPASSRLS is a role
-- attribute and is never inherited through membership: a login user reaches
-- it only by acting as the role (`ALTER ROLE <login> SET role = ...`, see the
-- setup steps in apps/docs/.../environment-variables.mdx).
--
-- Both are NOLOGIN, set again on every replay: the owner creates separate
-- login users with passwords by hand (never in git) and makes them members.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Created bare if missing, then given their attributes every time: CI
  -- rebuilds roles from a schema dump, which names them but carries neither
  -- their attributes nor their memberships.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_admin_read') THEN CREATE ROLE ob_admin_read; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_admin_write') THEN CREATE ROLE ob_admin_write; END IF;
  ALTER ROLE ob_admin_read NOLOGIN BYPASSRLS;
  ALTER ROLE ob_admin_write NOLOGIN BYPASSRLS;
  -- Whoever runs migrations may SET ROLE to them, so tests can check the
  -- grants as the admin app meets them. SET only, no INHERIT.
  EXECUTE format('GRANT ob_admin_read, ob_admin_write TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END
$$;

-- Explicit table grants only, no default privileges: a table added later is
-- out of reach until a migration grants it.
GRANT USAGE ON SCHEMA public TO ob_admin_read, ob_admin_write;

-- ---------------------------------------------------------------------------
-- ob_admin_read: what the pages show
-- ---------------------------------------------------------------------------

GRANT SELECT ON
  bookings, reservations, rooms, rate_plans, properties,  -- search, booking page
  booking_intents,                                        -- the charged account (loadBookingState)
  transactions, refunds,                                  -- booking page: money
  booking_events,                                         -- booking page: timeline
  message_threads, messages,                              -- booking page: messages
  support_tickets,                                        -- booking page: support tickets
  audit_log, "organization", "member",                    -- flagged payments, owners to email
  invoice_runs, invoices                                  -- invoices page
TO ob_admin_read;

-- Guest and owner names and emails.
GRANT SELECT (id, name, email) ON "user" TO ob_admin_read;

-- ---------------------------------------------------------------------------
-- ob_admin_write: what the server actions do
-- ---------------------------------------------------------------------------

-- Reads inside the actions: the booking and its rooms, refunds and charged
-- account (loadBookingState, actorFor, forced edits), the flag being
-- resolved (audit_log) and the event its resolve writes (RETURNING), and
-- what the cancellation and refund emails show and whom they go to.
GRANT SELECT ON
  bookings, reservations, refunds, properties, booking_intents,
  audit_log, booking_events,
  rooms, rate_plans, property_content, "member"
TO ob_admin_write;
GRANT SELECT (id, name, email) ON "user" TO ob_admin_write;

-- New rows: refunds the lifecycle issues, the booking's event log (every
-- action writes one), and audit rows (a refund Stripe refused, a resolved flag).
GRANT INSERT ON refunds, booking_events, audit_log TO ob_admin_write;

-- Changed columns. Lifecycle: cancel, check-in, no-show, early departure.
-- Forced edits: status, un-cancel, clearing the no-show and early-departure
-- markers. Row locks (FOR UPDATE) need UPDATE on a column, which these give.
GRANT UPDATE (status, cancelled_at, cancellation_reason, no_show_reported_at, departed_early_on, updated_at)
  ON bookings TO ob_admin_write;
GRANT UPDATE (cancelled_at) ON reservations TO ob_admin_write;
-- A refund's outcome and retry clock (lifecycle), its status (forced edit).
GRANT UPDATE (status, stripe_refund_id, last_attempt_at) ON refunds TO ob_admin_write;

-- Forced edit "delete refund row" (demo data clean-up).
GRANT DELETE ON refunds TO ob_admin_write;

-- Resolving a flagged payment records the host's room price / tourist tax
-- split on the booking's outside-refund row (0053, which must run first).
GRANT UPDATE (accommodation_amount, tourist_tax_amount, split_explained_at, split_explained_by)
  ON refunds TO ob_admin_write;
