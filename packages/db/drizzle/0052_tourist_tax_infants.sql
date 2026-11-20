-- 0052_tourist_tax_infants — the host says whether infants pay tourist tax.
--
-- Infants (under 2) take no place in the room. Some towns tax them per person
-- like children, most don't. Each tourist tax rule now says which: off by
-- default, so infants are exempt unless the host turns it on. A rule that
-- exempts children exempts infants as well, whatever this says.
--
--   tourist_tax_rules.infants_taxed  boolean, default false
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE tourist_tax_rules ADD COLUMN IF NOT EXISTS infants_taxed boolean NOT NULL DEFAULT false;
