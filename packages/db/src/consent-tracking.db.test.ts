import { afterAll, expect, test } from "bun:test";
import { describeWithDb } from "./testing/db-harness";
import { consentVersionOf, insertConsentEvent, latestAnalyticsConsent, query, userIdByEmail } from "./index";

const userIds: string[] = [];

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  userIds.push(id);
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, true, 'private')`,
    [id, email],
  );
  return id;
}

function consent(userId: string, analytics: boolean, bannerVersion: string) {
  return insertConsentEvent({
    consentId: crypto.randomUUID(),
    eventType: analytics ? "granted" : "denied",
    categories: { analytics },
    bannerVersion,
    app: "web",
    userId,
    idempotencyKey: crypto.randomUUID(),
  });
}

describeWithDb("consent tracking lookups", () => {
  afterAll(async () => {
    if (userIds.length === 0) return;
    await query(`DELETE FROM consent_log WHERE user_id = ANY($1::text[])`, [userIds]);
    await query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [userIds]);
  });

  test("latestAnalyticsConsent is null without rows", async () => {
    const id = await insertUser(`track-${crypto.randomUUID()}@example.test`);
    expect(await latestAnalyticsConsent(id)).toBeNull();
  }, 30_000);

  test("latestAnalyticsConsent returns the newest unexpired row", async () => {
    const id = await insertUser(`track-${crypto.randomUUID()}@example.test`);
    await consent(id, false, "1");
    await consent(id, true, "2");
    expect(await latestAnalyticsConsent(id)).toEqual({ analytics: true, bannerVersion: "2" });
  }, 30_000);

  test("latestAnalyticsConsent ignores an expired newer row", async () => {
    const id = await insertUser(`track-${crypto.randomUUID()}@example.test`);
    await consent(id, true, "1");
    await consent(id, false, "2");
    await query(
      `UPDATE consent_log SET expires_at = now() - interval '1 day' WHERE user_id = $1 AND banner_version = '2'`,
      [id],
    );
    expect(await latestAnalyticsConsent(id)).toEqual({ analytics: true, bannerVersion: "1" });
  }, 30_000);

  test("userIdByEmail matches case-insensitively", async () => {
    const email = `track-${crypto.randomUUID()}@example.test`;
    const id = await insertUser(email);
    expect(await userIdByEmail(email.toUpperCase())).toBe(id);
    expect(await userIdByEmail(`track-${crypto.randomUUID()}@example.test`)).toBeNull();
  }, 30_000);
});

test("consentVersionOf reads the integer before the first +", () => {
  expect(consentVersionOf("2+privacy@2026-10-03/en")).toBe(2);
  expect(consentVersionOf("10")).toBe(10);
  expect(consentVersionOf("1")).toBe(1);
  expect(consentVersionOf("x")).toBeNull();
});
