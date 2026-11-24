import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Queryable } from "./db/migrate";
import { type DoorbellDeps, MAX_DOORBELL_BYTES, verifyDoorbell } from "./doorbell";
import { createApp } from "./index";
import { upsertInstallation } from "./installations";
import { skipDbTests, withTestDb } from "./testing/db-harness";
import type { TickDeps, TickResult } from "./tick";

const ID = "5d1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c55";
const reg = { installationId: ID, propertyCode: "SM-BELL-2031", propertyName: "Hotel Bell", apiKey: "key-bell", coreBaseUrl: "https://core.example" };
const soapDeps = { now: () => new Date("2031-04-01T08:00:00.000Z"), clientFor: () => { throw new Error("no core"); } };
const noDb = (): Queryable => { throw new Error("db must not be touched"); };
const BASE = "https://siteminder.example.com";

const post = (app: ReturnType<typeof createApp>, body: string, headers: Record<string, string> = {}) =>
  app.request("/doorbell", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("verifyDoorbell", () => {
  const saved = { c: process.env.QSTASH_CURRENT_SIGNING_KEY, n: process.env.QSTASH_NEXT_SIGNING_KEY };
  afterEach(() => {
    for (const [k, v] of [["QSTASH_CURRENT_SIGNING_KEY", saved.c], ["QSTASH_NEXT_SIGNING_KEY", saved.n]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is false without a signature, without keys, and for a signature that is not QStash's", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next-key";
    const i = { rawBody: "{}", signature: "not.a.jwt", url: `${BASE}/doorbell` };
    expect(await verifyDoorbell({ ...i, signature: undefined })).toBe(false);
    expect(await verifyDoorbell(i)).toBe(false);
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    expect(await verifyDoorbell(i)).toBe(false);
  });
});

describe("POST /doorbell", () => {
  let ticks: { deps: TickDeps; installationId?: string }[];
  let tickResult: () => Promise<TickResult>;
  const tickDeps = (): TickDeps => ({ db: {} as Queryable, client: () => { throw new Error("no core"); }, now: () => new Date(), sleep: async () => {} });
  const quiet = [] as ReturnType<typeof spyOn>[];
  beforeEach(() => { ticks = []; tickResult = async () => ({ inboxApplied: 0, inboxFailed: 0 }); quiet.push(spyOn(console, "error").mockImplementation(() => {})); });
  afterEach(() => { for (const s of quiet.splice(0)) s.mockRestore(); });

  const deps = (valid: boolean, configured = true): { deps: DoorbellDeps; verified: { url: string; rawBody: string; signature: string | undefined }[] } => {
    const verified: { url: string; rawBody: string; signature: string | undefined }[] = [];
    return { verified, deps: { baseUrl: () => (configured ? BASE : undefined), verify: async (i) => { verified.push(i); return valid; }, tick: (d, i) => { ticks.push({ deps: d, installationId: i?.installationId }); return tickResult(); } } };
  };

  it("answers 503 and does nothing when QStash is not configured, even for a request that looks signed", async () => {
    const d = deps(true, false);
    const res = await post(createApp(noDb, soapDeps, tickDeps, d.deps), JSON.stringify({ installationId: ID }), { "upstash-signature": "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "doorbell not configured" });
    expect(d.verified).toEqual([]);
  });

  it("answers 403 for a missing or invalid signature and never touches the database", async () => {
    const d = deps(false);
    const app = createApp(noDb, soapDeps, tickDeps, d.deps);
    expect((await post(app, JSON.stringify({ installationId: ID }))).status).toBe(403);
    expect((await post(app, JSON.stringify({ installationId: ID }), { "upstash-signature": "bad" })).status).toBe(403);
    expect(ticks).toEqual([]);
  });

  it("verifies the exact raw body against ${serviceBaseUrl}/doorbell", async () => {
    const d = deps(false);
    const raw = ` { "installationId" : "${ID}" } `;
    await post(createApp(noDb, soapDeps, tickDeps, d.deps), raw, { "upstash-signature": "sig" });
    expect(d.verified).toEqual([{ rawBody: raw, signature: "sig", url: `${BASE}/doorbell` }]);
  });

  it("refuses a body over the cap before verifying it", async () => {
    const d = deps(true);
    const res = await post(createApp(noDb, soapDeps, tickDeps, d.deps), "x".repeat(MAX_DOORBELL_BYTES + 1), { "upstash-signature": "sig" });
    expect(res.status).toBe(413);
    expect(d.verified).toEqual([]);
  });

  it("answers 202 and does nothing for a malformed body", async () => {
    const d = deps(true);
    const app = createApp(noDb, soapDeps, tickDeps, d.deps);
    for (const body of ["not json", "null", "{}", JSON.stringify({ installationId: 5 }), JSON.stringify({ installationId: "nope" })]) {
      expect((await post(app, body, { "upstash-signature": "sig" })).status).toBe(202);
    }
    expect(ticks).toEqual([]);
  });

  it.skipIf(skipDbTests)("answers 202 and does nothing for an unknown or removed installation (rolled back)", async () => {
    await withTestDb(async (db) => {
      const d = deps(true);
      const app = createApp(() => db, soapDeps, tickDeps, d.deps);
      expect((await post(app, JSON.stringify({ installationId: ID }), { "upstash-signature": "sig" })).status).toBe(202);
      await upsertInstallation(db, reg);
      await db.query(`UPDATE siteminder.installations SET status = 'removed' WHERE id = $1`, [ID]);
      expect((await post(app, JSON.stringify({ installationId: ID }), { "upstash-signature": "sig" })).status).toBe(202);
      expect(ticks).toEqual([]);
    });
  });

  it.skipIf(skipDbTests)("answers 202 for a valid doorbell and ticks that installation without waiting for it (rolled back)", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      tickResult = () => new Promise<TickResult>(() => {}); // never finishes: the answer must not depend on it
      const d = deps(true);
      const res = await post(createApp(() => db, soapDeps, tickDeps, d.deps), JSON.stringify({ installationId: ID }), { "upstash-signature": "sig" });
      expect(res.status).toBe(202);
      expect(ticks.map((t) => t.installationId)).toEqual([ID]);
    });
  });

  it.skipIf(skipDbTests)("logs and swallows a failing tick (rolled back)", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      tickResult = async () => { throw new Error("boom"); };
      const d = deps(true);
      const res = await post(createApp(() => db, soapDeps, tickDeps, d.deps), JSON.stringify({ installationId: ID }), { "upstash-signature": "sig" });
      expect(res.status).toBe(202);
      await Bun.sleep(5);
      expect(ticks).toHaveLength(1);
    });
  });
});
