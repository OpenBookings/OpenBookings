/**
 * Apply ./drizzle/*.sql to a real database, once each, unattended.
 *
 * Not `drizzle-kit migrate`: ./drizzle has no meta/_journal.json, starts at
 * 0006 and contains two 0007_* files, so drizzle has no baseline to diff
 * against. See scripts/apply-schema-ci.ts for the same constraint from the
 * other direction. These files are hand-written and applied by hand today;
 * this script is the smallest thing that makes that repeatable in CI.
 *
 * What it tracks: a table of filenames it has already run, plus the sha256 of
 * each file as it was when applied. Editing an already-applied migration is
 * then a hard error rather than a silent no-op on one database and a surprise
 * on the next.
 *
 * Baselining: on the very first run, if the database already has application
 * tables, every existing file is recorded as applied *without executing it*.
 * That is what makes it safe to point at production, which is already at 0015
 * by hand. A genuinely empty database (a fresh CI one) gets everything
 * applied instead. After that first run the two paths converge.
 *
 * Uses the pg dependency this package already has, so it needs nothing
 * preinstalled on the runner.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

// The pooler rewrites and batches statements, which breaks DDL and advisory
// locks. Migrations must talk to Postgres directly.
const connectionString = process.env.DATABASE_URL_DIRECT;

if (!connectionString) {
  throw new Error("Set DATABASE_URL_DIRECT before running migrations");
}

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));
const TRACKING_TABLE = "__ob_migrations";
// A file may opt out of the surrounding transaction by containing this marker.
// Needed for statements Postgres refuses to run in a transaction block, of
// which CREATE INDEX CONCURRENTLY is the one this repo will plausibly want --
// 0008_missing_fk_indexes.sql already notes it as the escape hatch if those
// tables outgrow a brief lock, and the expand/contract rule that a canary
// imposes makes zero-downtime index builds more likely, not less.
const NO_TRANSACTION_MARKER = "ob:no-transaction";
// Arbitrary but fixed: two runs racing (a re-run of an old workflow, say) must
// serialise rather than interleave half-applied DDL.
const ADVISORY_LOCK_KEY = 4_812_003_117;

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  // Lexical, which is also numeric here because every file is zero-padded.
  // The two 0007_* files sort deterministically by their suffix.
  .sort();

if (files.length === 0) {
  throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function migrate(client: Client): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

  // Ask before creating, so we can tell a first run from a later one.
  const { rows: existing } = await client.query<{ present: string | null }>(
    "SELECT to_regclass($1)::text AS present",
    [TRACKING_TABLE],
  );
  const firstRun = existing[0]?.present === null;

  await client.query(`
    CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (
      "filename" text PRIMARY KEY,
      "sha256" text NOT NULL,
      "applied_at" timestamptz NOT NULL DEFAULT now(),
      -- false for the rows written by the initial baseline, whose SQL this
      -- script never executed. Keeps the audit trail honest.
      "executed" boolean NOT NULL DEFAULT true
    )
  `);

  if (firstRun) {
    const { rows } = await client.query<{ tables: string }>(
      `SELECT count(*)::text AS tables
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> $1`,
      [TRACKING_TABLE],
    );
    const isPopulated = Number(rows[0]?.tables ?? 0) > 0;

    if (isPopulated) {
      for (const filename of files) {
        const contents = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
        await client.query(
          `INSERT INTO "${TRACKING_TABLE}" ("filename", "sha256", "executed") VALUES ($1, $2, false)`,
          [filename, sha256(contents)],
        );
      }
      console.log(
        `Baselined ${files.length} migration(s) against an existing database; ` +
          "none were executed. Later runs apply only what is added after this point.",
      );
      return;
    }

    console.log("Empty database: applying every migration from the start.");
  }

  const { rows: applied } = await client.query<{ filename: string; sha256: string }>(
    `SELECT "filename", "sha256" FROM "${TRACKING_TABLE}"`,
  );
  const appliedBySha = new Map(applied.map((r) => [r.filename, r.sha256]));

  const pending: string[] = [];

  for (const filename of files) {
    const contents = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const recorded = appliedBySha.get(filename);

    if (recorded === undefined) {
      pending.push(filename);
      continue;
    }

    if (recorded !== sha256(contents)) {
      throw new Error(
        `${filename} was already applied but its contents have changed since. ` +
          "An applied migration is history and must not be edited -- add a new " +
          "file instead. If the edit was cosmetic and the SQL is unchanged in " +
          `effect, update its sha256 in "${TRACKING_TABLE}" by hand.`,
      );
    }
  }

  for (const filename of appliedBySha.keys()) {
    if (!files.includes(filename)) {
      console.warn(`::warning::${filename} is recorded as applied but no longer exists on disk`);
    }
  }

  if (pending.length === 0) {
    console.log(`Nothing to apply; ${applied.length} migration(s) already recorded.`);
    return;
  }

  for (const filename of pending) {
    const contents = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    console.log(`Applying ${filename}...`);

    const record = `INSERT INTO "${TRACKING_TABLE}" ("filename", "sha256") VALUES ($1, $2)`;
    const values = [filename, sha256(contents)];

    if (contents.includes(NO_TRANSACTION_MARKER)) {
      // No transaction to roll back: if this one fails partway it leaves the
      // database half-migrated and unrecorded, and needs sorting out by hand.
      // That is the cost of the marker, so the file should be written to
      // tolerate a re-run.
      console.log(`  (${NO_TRANSACTION_MARKER}: running outside a transaction)`);
      try {
        await client.query(contents);
      } catch (error) {
        throw new Error(
          `${filename} failed outside a transaction and may be partly applied: ` +
            `${(error as Error).message}`,
        );
      }
      await client.query(record, values);
      continue;
    }

    // The file and its bookkeeping commit together, so a failure halfway
    // cannot leave a migration applied but unrecorded. A file containing its
    // own BEGIN/COMMIT would break this; none of them do.
    await client.query("BEGIN");
    try {
      await client.query(contents);
      await client.query(record, values);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${filename} failed and was rolled back: ${(error as Error).message}`);
    }
  }

  console.log(`Applied ${pending.length} migration(s): ${pending.join(", ")}`);
}

const client = new Client({ connectionString });
await client.connect();

try {
  await migrate(client);
} finally {
  await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
  await client.end();
}
