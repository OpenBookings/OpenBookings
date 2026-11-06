import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { insertDemoProperty } from "./factories";
import { hostRecipients } from "./recipients";

let db: Client;

describeWithDb("hostRecipients", () => {
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

  async function build(isDemo: boolean) {
    const orgId = crypto.randomUUID();
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    const owners = [crypto.randomUUID(), crypto.randomUUID()];
    const member = crypto.randomUUID();
    for (const [i, id] of [...owners, member].entries()) {
      await db.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, true, 'business')`,
        [id, `${i < 2 ? "owner" : "staff"}${i}-${id}@example.test`],
      );
      await db.query(
        `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`,
        [orgId, id, i < 2 ? "owner" : "member"],
      );
    }
    const { propertyId } = await insertDemoProperty(db, {
      name: "Hotel",
      slug: `hotel-${crypto.randomUUID()}`,
      city: "Lisbon",
      country: "PT",
      timezone: "Europe/Lisbon",
      lat: 38.7,
      lon: -9.1,
      cancellationTier: "flex",
      organizationId: orgId,
      images: { hero: "https://cdn.example/h.avif", gallery: [] },
    });
    if (!isDemo) await db.query(`UPDATE properties SET is_demo = false WHERE id = $1`, [propertyId]);
    const { rows } = await db.query(`SELECT email FROM "user" WHERE id = ANY($1::text[]) ORDER BY email`, [owners]);
    return { propertyId, ownerEmails: rows.map((r) => r.email as string) };
  }

  test("a demo property in testing mode mails the signed-in guest", async () => {
    const { propertyId } = await build(true);
    expect(await hostRecipients(db, { propertyId, guestEmail: "guest@example.com", testing: true })).toEqual(["guest@example.com"]);
  });

  test("a demo property outside testing mode mails the owners", async () => {
    const { propertyId, ownerEmails } = await build(true);
    expect(await hostRecipients(db, { propertyId, guestEmail: "guest@example.com", testing: false })).toEqual(ownerEmails);
  });

  test("a real property mails its owners only, even in testing mode", async () => {
    const { propertyId, ownerEmails } = await build(false);
    expect(await hostRecipients(db, { propertyId, guestEmail: "guest@example.com", testing: true })).toEqual(ownerEmails);
  });
});
