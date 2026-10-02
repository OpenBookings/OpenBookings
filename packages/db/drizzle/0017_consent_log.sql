-- 0017_consent_log — server-side evidence of cookie-consent decisions.
--
-- Apply BY HAND, same as every file here: this repo has no drizzle journal.
-- Every statement is idempotent. Mirrors `consentLog` in
-- packages/db/src/schema.ts; keep the two in sync.
--
-- Append-only: one row per event, never updated. The visitor's device stays
-- the source of truth for whether analytics runs; this table only proves what
-- was chosen, for which categories, under which banner and policy wording.
--
-- No IP address and no user agent, on purpose. `consent_id` is a random id
-- minted on the device and identifies that device's consent record, not a
-- person. `user_id` has no foreign key: the row must outlive account
-- deletion as evidence, so erasure nulls the column and keeps the row (the
-- one UPDATE this table ever sees).

CREATE TABLE IF NOT EXISTS consent_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id      uuid        NOT NULL,
  event_type      text        NOT NULL CONSTRAINT consent_log_event_type_check CHECK (event_type IN ('granted', 'denied', 'withdrawn', 'linked')),
  categories      jsonb       NOT NULL,
  banner_version  text        NOT NULL,
  app             text        NOT NULL CONSTRAINT consent_log_app_check CHECK (app IN ('web', 'business')),
  user_id         text        NULL,
  -- Minted by the client per event, so a retried request cannot write twice.
  idempotency_key uuid        NOT NULL UNIQUE,
  -- Both set by the server; the client's clock is not trusted.
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_log_consent_id_idx ON consent_log (consent_id, created_at);
CREATE INDEX IF NOT EXISTS consent_log_user_id_idx ON consent_log (user_id) WHERE user_id IS NOT NULL;
