import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS_DIR, applyMigrations } from "./migrate";
import { skipDbTests, withTestDb } from "../testing/db-harness";

describe.skipIf(skipDbTests)("migrations (rolled back)", () => {
  it("create the three tables in schema siteminder", async () => {
    await withTestDb(async (db) => {
      const { rows } = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'siteminder' ORDER BY table_name`,
      );
      expect(rows.map((r) => r.table_name)).toEqual(["inbox", "installations", "migrations", "outbox"]);
    });
  });

  it("record each file with its sha256, and apply nothing twice", async () => {
    await withTestDb(async (db) => {
      const { rows } = await db.query<{ filename: string; sha256: string }>(`SELECT filename, sha256 FROM siteminder.migrations ORDER BY filename`);
      expect(rows.map((r) => r.filename)).toEqual(["0001_init.sql", "0002_inbox_lease.sql", "0003_poll_cadence.sql", "0004_delivery.sql", "0005_first_failure.sql", "0006_commit_attempt.sql", "0007_inbox_alerted.sql"]);
      for (const row of rows) expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await applyMigrations(db)).toEqual([]);
    });
  });

  it("enforce the outbox and inbox constraints", async () => {
    await withTestDb(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO siteminder.installations (property_code) VALUES ('TEST-2031') RETURNING id`,
      );
      const id = rows[0]!.id;
      await db.query(`INSERT INTO siteminder.outbox (installation_id, booking_id, unique_id, status) VALUES ($1, gen_random_uuid(), 'OBX', 'waiting')`, [id]);
      const out = await db.query(`SELECT acked, attempts FROM siteminder.outbox`);
      expect(out.rows[0]).toEqual({ acked: "none", attempts: 0 });

      await db.query("SAVEPOINT bad");
      await expect(
        db.query(`INSERT INTO siteminder.outbox (installation_id, booking_id, unique_id, acked) VALUES ($1, gen_random_uuid(), 'OBY', 'maybe')`, [id]),
      ).rejects.toThrow();
      await db.query("ROLLBACK TO SAVEPOINT bad");

      const token = crypto.randomUUID();
      await db.query(`INSERT INTO siteminder.inbox (installation_id, echo_token, kind) VALUES ($1, $2, 'avail')`, [id, token]);
      await db.query("SAVEPOINT dup");
      await expect(
        db.query(`INSERT INTO siteminder.inbox (installation_id, echo_token, kind) VALUES ($1, $2, 'avail')`, [id, token]),
      ).rejects.toThrow();
      await db.query("ROLLBACK TO SAVEPOINT dup");
    });
  });

  it("refuse a migration file edited after it was applied", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sm-migrations-"));
    try {
      await writeFile(path.join(dir, "0001_a.sql"), "CREATE TABLE siteminder.scratch_a (id int);\n");
      await withTestDb(async (db) => {
        expect((await applyMigrations(db, dir)).map((m) => m.filename)).toEqual(["0001_a.sql"]);
        await writeFile(path.join(dir, "0001_a.sql"), "CREATE TABLE siteminder.scratch_a (id bigint);\n");
        await expect(applyMigrations(db, dir)).rejects.toThrow("0001_a.sql was edited");
        // A new file after an unchanged one still applies.
        await writeFile(path.join(dir, "0001_a.sql"), "CREATE TABLE siteminder.scratch_a (id int);\n");
        await writeFile(path.join(dir, "0002_b.sql"), "CREATE TABLE siteminder.scratch_b (id int);\n");
        expect((await applyMigrations(db, dir)).map((m) => m.filename)).toEqual(["0002_b.sql"]);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leave nothing behind once the harness rolls back", async () => {
    await withTestDb(async () => {});
    await withTestDb(async (db) => {
      // Fresh transaction: the migrations table was created again (one row per file), not found.
      const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql"));
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM siteminder.migrations`);
      expect(rows[0]).toEqual({ n: files.length });
    });
  });
});
