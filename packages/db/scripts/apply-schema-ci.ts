/**
 * Prepare an ephemeral CI database: enable PostGIS, then apply the schema.
 *
 * Not `drizzle-kit push`: push diffs src/schema.ts against the live database,
 * and in 1.0.0-rc.4 that cannot resolve create-vs-rename without a TTY, so on
 * an empty database it exits with `missing_hints: 23 unresolved decisions`
 * even under --force. `export --sql` renders the schema against an empty
 * state, which is deterministic and exactly what a throwaway database wants.
 *
 * Not `drizzle-kit migrate` either: ./drizzle has no meta/_journal.json,
 * starts at 0006 and contains two 0007_* files.
 *
 * Uses the pg dependency this package already has, so it needs nothing
 * preinstalled on the runner.
 *
 * NOTE: CI no longer calls this. It runs against a throwaway Neon branch,
 * because src/schema.ts does not describe the Better Auth / IAM tables
 * (`user`, `session`, `organization`, `property_access`, ...) and so what this
 * renders is missing fifteen of them -- enough that any query joining `"user"`
 * cannot be tested. This remains the way to get a local database up without
 * reaching for Neon:
 *
 *   docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 \
 *     --platform linux/amd64 postgis/postgis:17-3.5-alpine
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
 *     bun run db:setup:ci
 *
 * (`--platform` because that tag publishes no arm64 image.)
 */
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL before applying the CI schema");
}

const exported = spawnSync("bunx", ["drizzle-kit", "export", "--sql"], {
  encoding: "utf8",
});

if (exported.status !== 0) {
  throw new Error(`drizzle-kit export failed:\n${exported.stderr}`);
}

const ddl = exported.stdout;

if (!ddl.includes("CREATE TABLE")) {
  throw new Error(`drizzle-kit export produced no DDL:\n${ddl}`);
}

const pool = new Pool({ connectionString });

try {
  // properties.location is geography(point, 4326) and the ARI/search queries
  // call ST_DWithin, ST_MakePoint and ST_X/ST_Y. No migration declares the
  // extension — production had it enabled out of band — so do it here.
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await pool.query(ddl);

  const { rows } = await pool.query<{ tables: string }>(
    "SELECT count(*)::text AS tables FROM information_schema.tables WHERE table_schema = 'public'",
  );
  console.log(`Schema applied: ${rows[0]?.tables} tables in public`);
} finally {
  await pool.end();
}
