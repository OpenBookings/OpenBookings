import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { activeInstallations, installationByHotelCode, removeInstallation, upsertInstallation } from "./installations";
import { createApp } from "./index";
import { skipDbTests, withTestDb } from "./testing/db-harness";

const reg = {
  installationId: "5f1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c01",
  propertyCode: "SM-TEST-2031",
  propertyName: "Hotel Test",
  apiKey: "key-1",
  coreBaseUrl: "https://core.example",
};

describe.skipIf(skipDbTests)("installation registry (rolled back)", () => {
  it("register, then find by hotel code", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      expect(await installationByHotelCode(db, reg.propertyCode)).toEqual({
        id: reg.installationId, propertyCode: reg.propertyCode, propertyName: reg.propertyName,
        apiKey: "key-1", coreBaseUrl: reg.coreBaseUrl, status: "active", feedCursor: null,
      });
      expect(await installationByHotelCode(db, "SM-NOPE-2031")).toBeNull();
      expect((await activeInstallations(db)).map((i) => i.id)).toContain(reg.installationId);
    });
  });

  it("re-registration refreshes details and keeps the feed cursor", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await db.query(`UPDATE siteminder.installations SET feed_cursor = 'cur-9' WHERE id = $1`, [reg.installationId]);
      await upsertInstallation(db, { ...reg, apiKey: "key-2", propertyName: "Renamed" });
      const found = await installationByHotelCode(db, reg.propertyCode);
      expect(found).toMatchObject({ apiKey: "key-2", propertyName: "Renamed", feedCursor: "cur-9", status: "active" });
    });
  });

  it("remove hides it; removing twice or an unknown id is fine; re-registering reactivates", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await removeInstallation(db, reg.installationId);
      await removeInstallation(db, reg.installationId);
      await removeInstallation(db, "11111111-1111-4111-8111-111111111111");
      expect(await installationByHotelCode(db, reg.propertyCode)).toBeNull();
      expect((await activeInstallations(db)).map((i) => i.id)).not.toContain(reg.installationId);
      await upsertInstallation(db, reg);
      expect(await installationByHotelCode(db, reg.propertyCode)).not.toBeNull();
    });
  });
});

describe.skipIf(skipDbTests)("registration routes (rolled back)", () => {
  const SECRET = "test-registration-secret";
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.APP_SITEMINDER_REGISTRATION_SECRET;
    process.env.APP_SITEMINDER_REGISTRATION_SECRET = SECRET;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.APP_SITEMINDER_REGISTRATION_SECRET;
    else process.env.APP_SITEMINDER_REGISTRATION_SECRET = previous;
  });

  const post = (app: ReturnType<typeof createApp>, body: unknown, auth?: string) =>
    app.request("/installations", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    });

  it("401 without the right bearer, on both routes", async () => {
    await withTestDb(async (db) => {
      const app = createApp(() => db);
      expect((await post(app, reg)).status).toBe(401);
      expect((await post(app, reg, "Bearer wrong")).status).toBe(401);
      expect((await post(app, reg, SECRET)).status).toBe(401);
      expect((await app.request(`/installations/${reg.installationId}`, { method: "DELETE" })).status).toBe(401);
      expect(await installationByHotelCode(db, reg.propertyCode)).toBeNull();
    });
  });

  it("400 on an invalid body", async () => {
    await withTestDb(async (db) => {
      const app = createApp(() => db);
      expect((await post(app, { propertyCode: "x" }, `Bearer ${SECRET}`)).status).toBe(400);
      expect((await post(app, { ...reg, installationId: "not-a-uuid" }, `Bearer ${SECRET}`)).status).toBe(400);
    });
  });

  it("POST registers (204), DELETE removes (204, idempotent)", async () => {
    await withTestDb(async (db) => {
      const app = createApp(() => db);
      const auth = `Bearer ${SECRET}`;
      expect((await post(app, reg, auth)).status).toBe(204);
      expect(await installationByHotelCode(db, reg.propertyCode)).not.toBeNull();
      const del = () => app.request(`/installations/${reg.installationId}`, { method: "DELETE", headers: { authorization: auth } });
      expect((await del()).status).toBe(204);
      expect((await del()).status).toBe(204);
      expect(await installationByHotelCode(db, reg.propertyCode)).toBeNull();
      const unknown = await app.request("/installations/11111111-1111-4111-8111-111111111111", { method: "DELETE", headers: { authorization: auth } });
      expect(unknown.status).toBe(204);
    });
  });
});
