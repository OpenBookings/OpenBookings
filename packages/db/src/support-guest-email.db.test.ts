import { afterAll, expect, test } from "bun:test";
import { describeWithDb } from "./testing/db-harness";
import { findGuestEmailByUserId, query } from "./index";

const userIds: string[] = [];

async function insertUser(opts: { accountType: "private" | "business"; emailVerified: boolean }) {
  const id = crypto.randomUUID();
  const email = `support-${id}@example.test`;
  userIds.push(id);
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, $3, $4)`,
    [id, email, opts.emailVerified, opts.accountType],
  );
  return { id, email };
}

describeWithDb("findGuestEmailByUserId", () => {
  afterAll(async () => {
    if (userIds.length > 0) await query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [userIds]);
  });

  test("returns the email of a guest account with a verified email", async () => {
    const guest = await insertUser({ accountType: "private", emailVerified: true });
    expect(await findGuestEmailByUserId(guest.id)).toBe(guest.email);
  }, 30_000);

  test("is null for host accounts, unverified emails and unknown ids", async () => {
    const host = await insertUser({ accountType: "business", emailVerified: true });
    const unverified = await insertUser({ accountType: "private", emailVerified: false });
    expect(await findGuestEmailByUserId(host.id)).toBeNull();
    expect(await findGuestEmailByUserId(unverified.id)).toBeNull();
    expect(await findGuestEmailByUserId(crypto.randomUUID())).toBeNull();
  }, 30_000);
});
