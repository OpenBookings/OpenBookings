import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { closePool, getPool } from "./pool";

/** Anything with pg's `query`: a client inside a transaction, usually. */
export type Queryable = Pick<PoolClient, "query">;

export const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../migrations");

export type AppliedMigration = { filename: string; sha256: string };

/**
 * Apply `*.sql` files from `dir` in filename order, recording each in
 * `siteminder.migrations` (filename + sha256). A recorded file whose content
 * changed is refused: edit history by adding a new migration, never an old one.
 *
 * Runs on the client it is given and opens no transaction of its own, so the
 * caller decides: `main()` wraps it in one, the test harness rolls it back.
 */
export async function applyMigrations(client: Queryable, dir: string = MIGRATIONS_DIR): Promise<AppliedMigration[]> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS siteminder`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS siteminder.migrations (
      filename text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const recorded = new Map<string, string>(
    (await client.query<{ filename: string; sha256: string }>(`SELECT filename, sha256 FROM siteminder.migrations`)).rows.map(
      (row) => [row.filename, row.sha256],
    ),
  );

  const applied: AppliedMigration[] = [];
  for (const filename of files) {
    const sql = await readFile(path.join(dir, filename), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const previous = recorded.get(filename);
    if (previous !== undefined) {
      if (previous !== sha256) {
        throw new Error(`Migration ${filename} was edited after it was applied. Add a new migration instead.`);
      }
      continue;
    }
    await client.query(sql);
    await client.query(`INSERT INTO siteminder.migrations (filename, sha256) VALUES ($1, $2)`, [filename, sha256]);
    applied.push({ filename, sha256 });
  }
  return applied;
}

async function migrateWithLock(pool: Pool): Promise<AppliedMigration[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One migrator at a time; released when the transaction ends.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('siteminder.migrate'))`);
    const applied = await applyMigrations(client);
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  try {
    const applied = await migrateWithLock(getPool());
    console.log(applied.length ? `Applied: ${applied.map((m) => m.filename).join(", ")}` : "Nothing to apply.");
  } finally {
    await closePool();
  }
}
