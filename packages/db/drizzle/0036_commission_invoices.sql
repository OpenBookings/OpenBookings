-- 0036_commission_invoices — the commission ledger and monthly invoices.
--
-- OpenBookings collects its commission per booking as a Stripe application
-- fee, and bills each host once a month for what was collected. These tables
-- hold that paper trail:
--
--   commission_entries  the ledger: one row per application fee and per fee
--                       refund, append-only (a trigger refuses DELETE and any
--                       UPDATE except invoice_id going from NULL to a value)
--   billing_profiles    the legal details of the buyer on the invoice
--   invoice_sequences   one gapless counter per series (OB-yyyy)
--   invoice_runs        what each step of the monthly job did
--   invoices            invoices and credit notes; frozen once issued (a
--                       trigger limits what may still change, and DELETE is
--                       only allowed on a draft)
--
-- bookings also gains the commission split the guest was charged: rate,
-- VAT treatment, net and VAT in cents (all NULL on bookings from before).
--
-- Billing records are kept for 7+ years, so every foreign key is ON DELETE
-- RESTRICT and no guest names, emails or addresses are stored here.
--
-- Apply by hand / CI. Additive: safe for the code running before this
-- deploy. Re-runnable.

-- Fail fast instead of queueing: ALTER TABLE bookings needs a brief exclusive
-- lock, and waiting behind a long transaction would hold up every bookings query.
SET lock_timeout = '5s';

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_rate numeric(6,5) NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_vat_treatment text NULL
  CHECK (commission_vat_treatment IN ('NL_DOMESTIC', 'EU_REVERSE_CHARGE'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_net_cents bigint NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_vat_cents bigint NULL;

CREATE TABLE IF NOT EXISTS billing_profiles (
  organization_id   text PRIMARY KEY REFERENCES "organization"(id) ON DELETE RESTRICT,
  legal_name        text,
  address_line1     text,
  address_line2     text,
  postal_code       text,
  city              text,
  country_code      char(2),
  vat_id            text,
  kvk_number        text,
  vat_id_checked_at timestamptz,
  vat_id_valid      boolean,
  vies_request_id   text,
  billing_email     text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  series     text PRIMARY KEY,
  next_value integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoice_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  step        text NOT NULL CHECK (step IN ('backfill', 'draft', 'issue', 'store', 'deliver', 'report')),
  status      text NOT NULL CHECK (status IN ('running', 'succeeded', 'blocked', 'failed')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  report      jsonb
);
CREATE INDEX IF NOT EXISTS invoice_runs_period_idx ON invoice_runs (period_start, step, started_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                      uuid REFERENCES invoice_runs(id) ON DELETE RESTRICT,
  billing_entity_id           text NOT NULL REFERENCES "organization"(id) ON DELETE RESTRICT,
  period_start                date NOT NULL,
  period_end                  date NOT NULL,
  doc_type                    text NOT NULL CHECK (doc_type IN ('invoice', 'credit_note')),
  status                      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'sent')),
  series                      text,
  sequence_number             integer,
  number                      text,
  issued_on                   date,
  seller                      jsonb,
  buyer                       jsonb,
  vat_treatment               text NOT NULL CHECK (vat_treatment IN ('NL_DOMESTIC', 'EU_REVERSE_CHARGE')),
  vat_rate_bp                 integer NOT NULL CHECK (vat_rate_bp IN (0, 2100)),
  fee_count                   integer NOT NULL DEFAULT 0,
  fee_base_total              bigint NOT NULL DEFAULT 0,
  fee_gross_total             bigint NOT NULL DEFAULT 0,
  refund_count                integer NOT NULL DEFAULT 0,
  refund_base_total           bigint NOT NULL DEFAULT 0,
  refund_gross_total          bigint NOT NULL DEFAULT 0,
  refers_to_invoice_numbers   text[] NOT NULL DEFAULT '{}',
  net_total                   bigint NOT NULL,
  vat_total                   bigint NOT NULL,
  gross_total                 bigint NOT NULL,
  vat_collected               bigint NOT NULL,
  vat_rounding_diff           bigint NOT NULL,
  pdf_key                     text,
  pdf_sha256                  text,
  csv_key                     text,
  csv_sha256                  text,
  sent_at                     timestamptz,
  email_message_id            text,
  CONSTRAINT invoices_number_key UNIQUE (number),
  CONSTRAINT invoices_entity_period_key UNIQUE (billing_entity_id, period_start),
  CONSTRAINT invoices_gross_check CHECK (gross_total = net_total + vat_total),
  CONSTRAINT invoices_issued_has_number CHECK (
    status = 'draft'
    OR (number IS NOT NULL AND series IS NOT NULL AND sequence_number IS NOT NULL AND issued_on IS NOT NULL
        AND seller IS NOT NULL AND buyer IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS invoices_run_idx ON invoices (run_id);

CREATE TABLE IF NOT EXISTS commission_entries (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                       text NOT NULL CHECK (kind IN ('fee', 'fee_refund')),
  billing_entity_id          text NOT NULL REFERENCES "organization"(id) ON DELETE RESTRICT,
  property_id                uuid REFERENCES properties(id) ON DELETE RESTRICT,
  booking_id                 uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  booking_intent_id          uuid REFERENCES booking_intents(id) ON DELETE RESTRICT,
  booking_ref                text,
  stay_start                 date,
  stay_end                   date,
  stripe_account_id          text NOT NULL,
  stripe_application_fee_id  text NOT NULL,
  stripe_fee_refund_id       text,
  stripe_payment_ref         text,
  base_amount                bigint NOT NULL,
  commission_net             bigint NOT NULL,
  vat_rate_bp                integer NOT NULL CHECK (vat_rate_bp IN (0, 2100)),
  vat_amount                 bigint NOT NULL,
  gross_amount               bigint NOT NULL,
  vat_treatment              text NOT NULL CHECK (vat_treatment IN ('NL_DOMESTIC', 'EU_REVERSE_CHARGE')),
  currency                   text NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
  occurred_at                timestamptz NOT NULL,
  invoice_id                 uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  refunds_entry_id           uuid REFERENCES commission_entries(id) ON DELETE RESTRICT,
  disposition                text NOT NULL CHECK (disposition IN ('booked', 'returned')),
  amount_mismatch            boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_entries_gross_check CHECK (gross_amount = commission_net + vat_amount),
  CONSTRAINT commission_entries_booked_check CHECK (
    disposition = 'returned'
    OR (booking_id IS NOT NULL AND property_id IS NOT NULL AND booking_ref IS NOT NULL
        AND stay_start IS NOT NULL AND stay_end IS NOT NULL)
  ),
  CONSTRAINT commission_entries_returned_not_invoiced CHECK (disposition = 'booked' OR invoice_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS commission_entries_fee_uidx
  ON commission_entries (stripe_application_fee_id) WHERE kind = 'fee';
CREATE UNIQUE INDEX IF NOT EXISTS commission_entries_fee_refund_uidx
  ON commission_entries (stripe_fee_refund_id);
CREATE INDEX IF NOT EXISTS commission_entries_entity_time_idx ON commission_entries (billing_entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS commission_entries_invoice_idx ON commission_entries (invoice_id);
CREATE INDEX IF NOT EXISTS commission_entries_booking_idx ON commission_entries (booking_id);

-- The ledger is append-only: rows are never deleted, and the only change a
-- row may ever take is being attached to an invoice, once.
CREATE OR REPLACE FUNCTION commission_entries_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commission_entries is append-only: rows cannot be deleted'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.invoice_id IS NOT NULL OR NEW.invoice_id IS NULL
     OR (to_jsonb(NEW) - 'invoice_id') IS DISTINCT FROM (to_jsonb(OLD) - 'invoice_id') THEN
    RAISE EXCEPTION 'commission_entries is append-only: only invoice_id may change, from NULL to a value'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commission_entries_append_only ON commission_entries;
CREATE TRIGGER commission_entries_append_only
  BEFORE UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION commission_entries_append_only();

-- An issued invoice is a legal document. Afterwards only its delivery state
-- may move: status issued -> sent, the stored files (set once), sent_at and
-- email_message_id. Only a draft may be deleted.
CREATE OR REPLACE FUNCTION invoices_immutable() RETURNS trigger AS $$
DECLARE
  movable text[] := ARRAY['status', 'pdf_key', 'pdf_sha256', 'csv_key', 'csv_sha256', 'sent_at', 'email_message_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'invoices are immutable once issued: only a draft can be deleted'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable)
     OR NOT (NEW.status = OLD.status OR (OLD.status = 'issued' AND NEW.status = 'sent'))
     OR (OLD.pdf_key IS NOT NULL AND NEW.pdf_key IS DISTINCT FROM OLD.pdf_key)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256)
     OR (OLD.csv_key IS NOT NULL AND NEW.csv_key IS DISTINCT FROM OLD.csv_key)
     OR (OLD.csv_sha256 IS NOT NULL AND NEW.csv_sha256 IS DISTINCT FROM OLD.csv_sha256) THEN
    RAISE EXCEPTION 'invoices are immutable once issued: only status (issued to sent), the pdf/csv keys (once), sent_at and email_message_id may change'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_immutable ON invoices;
CREATE TRIGGER invoices_immutable
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_immutable();

RESET lock_timeout;
