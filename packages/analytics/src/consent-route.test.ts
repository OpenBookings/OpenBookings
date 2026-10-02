import { describe, expect, test } from "bun:test";
import { createConsentHandler, type ConsentEventRow } from "./consent-route";

const ORIGIN = "https://openbookings.co";
const CID = "3f2b8c1e-5d4a-4b7e-9c1a-2f6d8e0b1a34";
const EVENT_UUID = "00000000-0000-4000-8000-000000000001";

const valid = {
  consentId: CID,
  eventType: "granted",
  categories: { analytics: true },
  bannerVersion: "1.1+privacy@2026-10-02/en",
  idempotencyKey: EVENT_UUID,
};

function setup(over: { userId?: string | null; insert?: (row: ConsentEventRow) => Promise<{ expiresAt: string }> } = {}) {
  const rows: ConsentEventRow[] = [];
  const handler = createConsentHandler({
    app: "web",
    insert:
      over.insert ??
      (async (row) => {
        rows.push(row);
        return { expiresAt: "2027-01-01T00:00:00.000Z" };
      }),
    getUserId: async () => over.userId ?? null,
  });
  return { handler, rows };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("consent handler", () => {
  test("stores a valid event and returns the server-set expiry", async () => {
    const { handler, rows } = setup();
    const res = await handler(post(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expiresAt: "2027-01-01T00:00:00.000Z" });
    expect(rows).toEqual([
      {
        consentId: CID,
        eventType: "granted",
        categories: { analytics: true },
        bannerVersion: "1.1+privacy@2026-10-02/en",
        app: "web",
        userId: null,
        idempotencyKey: EVENT_UUID,
      },
    ]);
  });

  test("takes the user id from the session", async () => {
    const { handler, rows } = setup({ userId: "user_1" });
    await handler(post(valid));
    expect(rows[0]?.userId).toBe("user_1");
  });

  test("rejects a body that tries to name its own user", async () => {
    const { handler, rows } = setup();
    const res = await handler(post({ ...valid, userId: "someone_else" }));
    expect(res.status).toBe(400);
    expect(rows).toEqual([]);
  });

  test("rejects unknown keys, including inside categories", async () => {
    const { handler, rows } = setup();
    expect((await handler(post({ ...valid, ip: "1.2.3.4" }))).status).toBe(400);
    expect((await handler(post({ ...valid, categories: { analytics: true, marketing: true } }))).status).toBe(400);
    expect(rows).toEqual([]);
  });

  test("rejects ids that are not UUIDs and unknown event types", async () => {
    const { handler } = setup();
    expect((await handler(post({ ...valid, consentId: "nope" }))).status).toBe(400);
    expect((await handler(post({ ...valid, idempotencyKey: "nope" }))).status).toBe(400);
    expect((await handler(post({ ...valid, eventType: "accepted" }))).status).toBe(400);
  });

  test("rejects an over-long banner version", async () => {
    const { handler } = setup();
    expect((await handler(post({ ...valid, bannerVersion: "x".repeat(101) }))).status).toBe(400);
  });

  test("rejects malformed JSON", async () => {
    const { handler } = setup();
    expect((await handler(post("{not json"))).status).toBe(400);
  });

  test("requires a JSON content type", async () => {
    const { handler, rows } = setup();
    const res = await handler(post(valid, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(rows).toEqual([]);
  });

  test("rejects a body over 2 KB", async () => {
    const { handler, rows } = setup();
    const res = await handler(post(JSON.stringify(valid) + " ".repeat(2100)));
    expect(res.status).toBe(413);
    expect(rows).toEqual([]);
  });

  test("rejects a cross-origin request", async () => {
    const { handler, rows } = setup();
    const res = await handler(post(valid, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(rows).toEqual([]);
  });

  test("a linked event needs a signed-in session", async () => {
    const anonymous = setup();
    const res = await anonymous.handler(post({ ...valid, eventType: "linked" }));
    expect(res.status).toBe(401);
    expect(anonymous.rows).toEqual([]);

    const signedIn = setup({ userId: "user_1" });
    expect((await signedIn.handler(post({ ...valid, eventType: "linked" }))).status).toBe(200);
    expect(signedIn.rows[0]?.userId).toBe("user_1");
  });

  test("a storage failure is a 500 that says nothing about why", async () => {
    const { handler } = setup({
      insert: async () => {
        throw new Error("connection refused at 10.0.0.5");
      },
    });
    const res = await handler(post(valid));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.5");
  });

  test("responses are never cached", async () => {
    const { handler } = setup();
    expect((await handler(post(valid))).headers.get("cache-control")).toBe("no-store");
  });
});
