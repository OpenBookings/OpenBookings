import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { CoreClient } from "./core-client";
import type { Queryable } from "./db/migrate";
import { storeInbound } from "./inbox";
import { createApp } from "./index";
import { upsertInstallation } from "./installations";
import { skipDbTests, withTestDb } from "./testing/db-harness";
import type { TickDeps } from "./tick";

const NOW = new Date("2031-04-01T08:00:00.000Z");
const reg = {
  installationId: "8e1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c91",
  propertyCode: "SM-HEALTH-2031",
  propertyName: "Hotel Health",
  apiKey: "key-health",
  coreBaseUrl: "https://core.example",
};
const soapDeps = { now: () => NOW, clientFor: () => { throw new Error("no core"); } };
const noDb = (): Queryable => { throw new Error("db must not be touched"); };

describe("GET /health", () => {
  it("answers 503 when the database cannot be reached", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await createApp(noDb, soapDeps).request("/health");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "database unavailable" });
    } finally {
      quiet.mockRestore();
    }
  });

  it.skipIf(skipDbTests)("reports inbox depth and the age of the oldest unprocessed message (rolled back)", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const received = new Date(NOW.getTime() - 90_000);
      await storeInbound(db, { installationId: reg.installationId, echoToken: crypto.randomUUID(), kind: "HotelAvailNotifRQ", changes: { inventory: [] }, now: received });
      const res = await createApp(() => db, soapDeps).request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, inboxDepth: 1, oldestUnprocessedSeconds: 90 });
    });
  });
});

describe("POST /tick", () => {
  const SECRET = "test-tick-secret";
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.SITEMINDER_TICK_SECRET;
    process.env.SITEMINDER_TICK_SECRET = SECRET;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.SITEMINDER_TICK_SECRET;
    else process.env.SITEMINDER_TICK_SECRET = previous;
  });
  const noTick = (): TickDeps => { throw new Error("tick must not run"); };

  it("401 without the secret, or with a wrong one", async () => {
    const app = createApp(noDb, soapDeps, noTick);
    expect((await app.request("/tick", { method: "POST" })).status).toBe(401);
    expect((await app.request("/tick", { method: "POST", headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await app.request("/tick", { method: "POST", headers: { authorization: SECRET } })).status).toBe(401);
  });

  it.skipIf(skipDbTests)("runs a tick with the secret and returns its counts (rolled back)", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await storeInbound(db, { installationId: reg.installationId, echoToken: crypto.randomUUID(), kind: "HotelAvailNotifRQ", changes: { inventory: [{ roomCode: "RH", from: "2031-05-01", to: "2031-05-01", unitsLeft: 1 }] }, now: NOW });
      const client = () => ({ writeAri: async () => ({ ok: true, nights: 1 }) }) as unknown as CoreClient;
      const tickDeps = (): TickDeps => ({ db, client, now: () => NOW, sleep: async () => {} });
      const res = await createApp(() => db, soapDeps, tickDeps).request("/tick", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ inboxApplied: 1, inboxFailed: 0 });
    });
  });
});
