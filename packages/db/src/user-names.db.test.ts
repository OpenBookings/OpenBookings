/**
 * drizzle/0059_user_first_last_name.sql: every user gets a first and a last
 * name next to `name`. The `user_names_sync` trigger keeps the three in step:
 * writing first/last rebuilds `name`; writing only `name` (Better Auth, older
 * code paths) splits it on the last whitespace. Existing rows are backfilled
 * by the same split rule.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  applyPendingMigrationsBefore,
  canReplayPendingMigrations,
  connectionString,
  describeWithDb,
  seedGuest,
} from "./testing/db-harness";
import { pendingMigrationSql } from "./testing/pending-migrations";

const MIGRATION = "0059_user_first_last_name.sql";

type Names = { name: string; first_name: string; last_name: string };

const newId = () => `test-names-${crypto.randomUUID()}`;

describeWithDb("first and last name on users (0059)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** Insert a user with only the given name columns; returns its id. */
  const insertUser = async (cols: Partial<Names>): Promise<string> => {
    const id = newId();
    const keys = Object.keys(cols) as (keyof Names)[];
    await db.query(
      `INSERT INTO "user" (id, email, "emailVerified", account_type${keys.map((k) => `, ${k}`).join("")})
       VALUES ($1, $2, true, 'private'::account_type${keys.map((_, i) => `, $${i + 3}`).join("")})`,
      [id, `${id}@example.test`, ...keys.map((k) => cols[k])],
    );
    return id;
  };
  const names = async (id: string): Promise<Names> =>
    (await db.query(`SELECT name, first_name, last_name FROM "user" WHERE id = $1`, [id])).rows[0] as Names;

  test("inserting first and last name sets name", async () => {
    const id = await insertUser({ first_name: "Anna de", last_name: "Vries" });
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna de", last_name: "Vries" });
  });

  test("inserting only name (Better Auth sign-up) splits it on the last whitespace", async () => {
    const id = await insertUser({ name: "José María García" });
    expect(await names(id)).toEqual({ name: "José María García", first_name: "José María", last_name: "García" });
  });

  test("a single-word name becomes the first name", async () => {
    const id = await insertUser({ name: "Zoë" });
    expect(await names(id)).toEqual({ name: "Zoë", first_name: "Zoë", last_name: "" });
  });

  test("a magic-link sign-up with an empty name has empty first and last names", async () => {
    const id = await insertUser({ name: "" });
    expect(await names(id)).toEqual({ name: "", first_name: "", last_name: "" });
  });

  test("first and last names are trimmed, the typed text otherwise kept", async () => {
    const id = await insertUser({ first_name: "  Anna  de ", last_name: " Vries\t" });
    expect(await names(id)).toEqual({ name: "Anna  de Vries", first_name: "Anna  de", last_name: "Vries" });
  });

  test("first and last name win over a name written alongside them", async () => {
    const id = await insertUser({ name: "Somebody Else", first_name: "Anna", last_name: "Vries" });
    expect(await names(id)).toEqual({ name: "Anna Vries", first_name: "Anna", last_name: "Vries" });
  });

  test("updating only name splits it into first and last name", async () => {
    const id = await insertUser({ first_name: "Anna", last_name: "Vries" });
    await db.query(`UPDATE "user" SET name = 'José García' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "José García", first_name: "José", last_name: "García" });
  });

  test("updating only the first name rebuilds name", async () => {
    const id = await insertUser({ first_name: "Anna", last_name: "Vries" });
    await db.query(`UPDATE "user" SET first_name = 'Anne-Marie' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anne-Marie Vries", first_name: "Anne-Marie", last_name: "Vries" });
  });

  test("updating only the last name rebuilds name", async () => {
    const id = await insertUser({ first_name: "Anna", last_name: "Vries" });
    await db.query(`UPDATE "user" SET last_name = 'van Dijk' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna van Dijk", first_name: "Anna", last_name: "van Dijk" });
  });

  test("updating first/last and name together: first and last name win", async () => {
    const id = await insertUser({ first_name: "Anna", last_name: "Vries" });
    await db.query(`UPDATE "user" SET name = 'Google Name', last_name = 'de Vries' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna", last_name: "de Vries" });
  });

  test("rewriting name with its current value keeps the names the guest set", async () => {
    const id = await insertUser({ first_name: "Anna de", last_name: "Vries" });
    await db.query(`UPDATE "user" SET name = 'Anna de Vries' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna de", last_name: "Vries" });
  });

  test("writing an empty name (magic-link) never wipes the names the guest set", async () => {
    const id = await insertUser({ first_name: "Anna de", last_name: "Vries" });
    await db.query(`UPDATE "user" SET name = '' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna de", last_name: "Vries" });
    await db.query(`UPDATE "user" SET name = '   ' WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna de", last_name: "Vries" });
  });

  test("updating an unrelated column changes nothing", async () => {
    const id = await insertUser({ first_name: "Anna de", last_name: "Vries" });
    await db.query(`UPDATE "user" SET image = 'https://example.test/a.png', "updatedAt" = now() WHERE id = $1`, [id]);
    expect(await names(id)).toEqual({ name: "Anna de Vries", first_name: "Anna de", last_name: "Vries" });
  });

  test("a name longer than 50 characters is stored, not refused (length is checked in the app)", async () => {
    const long = "X".repeat(80);
    const id = await insertUser({ name: `${long} ${long}` });
    expect(await names(id)).toEqual({ name: `${long} ${long}`, first_name: long, last_name: long });
  });

  test("seedGuest is Test Guest", async () => {
    const id = await seedGuest(db);
    expect(await names(id)).toEqual({ name: "Test Guest", first_name: "Test", last_name: "Guest" });
  });

  test("running the migration a second time changes nothing", async () => {
    await insertUser({ first_name: "Anna de", last_name: "Vries" });
    await insertUser({ name: "José García" });
    await insertUser({ name: "" });
    const snapshot = async () =>
      (
        await db.query(
          `SELECT md5(string_agg(row(id, name, first_name, last_name, "updatedAt")::text, ',' ORDER BY id)) AS h
             FROM "user"`,
        )
      ).rows[0].h as string;
    const before = await snapshot();
    await db.query(pendingMigrationSql(MIGRATION));
    expect(await snapshot()).toBe(before);
  });
});

// The backfill needs rows written before the columns exist. CI applies every
// pending migration before the tests, so this runs locally only.
const describeBackfill = connectionString && canReplayPendingMigrations ? describe : describe.skip;

describeBackfill("0059 backfills existing users", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrationsBefore(db, MIGRATION);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const legacyUser = async (name: string): Promise<string> => {
    const id = newId();
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, $2, $3, true, 'private'::account_type)`,
      [id, name, `${id}@example.test`],
    );
    return id;
  };
  const names = async (id: string): Promise<Names> =>
    (await db.query(`SELECT name, first_name, last_name FROM "user" WHERE id = $1`, [id])).rows[0] as Names;

  test("splits every existing name by the split rule, once", async () => {
    const long = "Y".repeat(70);
    const ids = {
      particle: await legacyUser("Sanne de Vries"),
      single: await legacyUser("Madonna"),
      empty: await legacyUser(""),
      blank: await legacyUser("   "),
      padded: await legacyUser("  Anna   Vries "),
      long: await legacyUser(`${long} ${long}`),
    };

    await db.query(pendingMigrationSql(MIGRATION));

    expect(await names(ids.particle)).toEqual({ name: "Sanne de Vries", first_name: "Sanne de", last_name: "Vries" });
    expect(await names(ids.single)).toEqual({ name: "Madonna", first_name: "Madonna", last_name: "" });
    expect(await names(ids.empty)).toEqual({ name: "", first_name: "", last_name: "" });
    expect((await names(ids.blank)).first_name).toBe("");
    expect((await names(ids.blank)).last_name).toBe("");
    expect(await names(ids.padded)).toEqual({ name: "Anna Vries", first_name: "Anna", last_name: "Vries" });
    expect(await names(ids.long)).toEqual({ name: `${long} ${long}`, first_name: long, last_name: long });

    const all = async () =>
      (await db.query(`SELECT id, name, first_name, last_name FROM "user" WHERE id = ANY($1) ORDER BY id`, [
        Object.values(ids),
      ])).rows;
    const before = await all();
    await db.query(pendingMigrationSql(MIGRATION));
    expect(await all()).toEqual(before);
  });
});
