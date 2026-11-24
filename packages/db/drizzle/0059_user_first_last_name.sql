-- 0059_user_first_last_name — a separate first and last name for every user.
--
-- Until now a user had one free-text `name`. Channel managers (SiteMinder)
-- need a real surname, so "user" gets two columns next to it:
--
--   first_name, last_name   text NOT NULL DEFAULT ''. Trimmed; the typed text
--                           is otherwise kept as is (particles, diacritics).
--   name                    stays, for Better Auth and every host-facing
--                           display, and always equals
--                           trim(first_name || ' ' || last_name).
--
-- The user_names_sync trigger keeps the three in step:
--
--   * first_name or last_name written (set on INSERT, changed on UPDATE):
--     name is rebuilt from them. A name written alongside them is ignored.
--   * otherwise, name written (Better Auth sign-up and profile updates, older
--     code paths): name is split by the split rule below. On UPDATE only when
--     name actually changed, so rewriting the same name keeps the first and
--     last name a guest set. An UPDATE to an empty or blank name (a magic-link
--     sign-in) never wipes them: name keeps its old value.
--   * an UPDATE of any other column changes nothing.
--
-- Split rule: the last whitespace-separated word is the last name, the rest
-- the first name; a single word is the first name with an empty last name.
-- `Anna de Vries` -> `Anna de` + `Vries`. Imperfect for particles, which is
-- why checkout and account details ask for both names from now on.
--
-- Existing users are backfilled by the split rule. Users with an empty name
-- (magic-link sign-ups) keep empty first and last names and are asked for
-- them at checkout.
--
-- No CHECK on the 50-character maximum: that is checked in the app. A legacy
-- name can be longer, and the backfill must never fail on one.
--
-- ob_app (0049) and the admin roles (0054) read "user" through column grants,
-- so they get SELECT on the two new columns, like `name`.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';

-- Strip leading and trailing whitespace (tabs and newlines too); NULL -> ''.
CREATE OR REPLACE FUNCTION app.trim_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT regexp_replace(coalesce(p_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') $$;

-- The split rule above.
CREATE OR REPLACE FUNCTION app.split_user_name(p_name text, OUT first_name text, OUT last_name text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  trimmed text := app.trim_name(p_name);
  parts text[] := regexp_match(trimmed, '^(.*[^[:space:]])[[:space:]]+([^[:space:]]+)$');
BEGIN
  IF parts IS NULL THEN
    first_name := trimmed;
    last_name := '';
  ELSE
    first_name := parts[1];
    last_name := parts[2];
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app.user_names_sync() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  names_written boolean;
  split record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    names_written := app.trim_name(NEW.first_name) <> '' OR app.trim_name(NEW.last_name) <> '';
  ELSE
    names_written := NEW.first_name IS DISTINCT FROM OLD.first_name
                  OR NEW.last_name IS DISTINCT FROM OLD.last_name;
  END IF;

  IF names_written THEN
    NEW.first_name := app.trim_name(NEW.first_name);
    NEW.last_name := app.trim_name(NEW.last_name);
  ELSIF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
    IF TG_OP = 'UPDATE' AND app.trim_name(NEW.name) = '' THEN
      NEW.name := OLD.name;
      RETURN NEW;
    END IF;
    split := app.split_user_name(NEW.name);
    NEW.first_name := split.first_name;
    NEW.last_name := split.last_name;
  ELSE
    RETURN NEW;
  END IF;

  NEW.name := app.trim_name(NEW.first_name || ' ' || NEW.last_name);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS user_names_sync ON "user";
CREATE TRIGGER user_names_sync
  BEFORE INSERT OR UPDATE OF name, first_name, last_name ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.user_names_sync();

-- Backfill. Goes through the trigger, so name is rebuilt (trimmed) as well.
-- Only rows without first and last name and with a non-blank name, so a
-- replay finds nothing to do.
UPDATE "user" u
   SET (first_name, last_name) = (SELECT s.first_name, s.last_name FROM app.split_user_name(u.name) s)
 WHERE u.first_name = '' AND u.last_name = ''
   AND app.trim_name(u.name) <> '';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['ob_app', 'ob_admin_read', 'ob_admin_write'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT (first_name, last_name) ON "user" TO %I', r);
    END IF;
  END LOOP;
END
$$;
