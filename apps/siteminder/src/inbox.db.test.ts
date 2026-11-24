import { describe, expect, it } from "bun:test";
import { inboxHealth, storeInbound } from "./inbox";
import { removeInstallation, upsertInstallation } from "./installations";
import { skipDbTests, withTestDb } from "./testing/db-harness";

const reg = {
  installationId: "3b1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c61",
  propertyCode: "SM-INBOX-2031",
  propertyName: "Hotel Inbox",
  apiKey: "key-inbox",
  coreBaseUrl: "https://core.example",
};
const NOW = new Date("2031-04-01T08:00:00.000Z");
const seconds = (s: number) => new Date(NOW.getTime() + s * 1000);
const inventory = [{ roomCode: "RINBOX2031", from: "2031-05-01", to: "2031-05-03", unitsLeft: 4 }];

describe.skipIf(skipDbTests)("storeInbound (rolled back)", () => {
  it("stores a message once; the same EchoToken again is a duplicate and changes nothing", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const echoToken = crypto.randomUUID();
      const message = { installationId: reg.installationId, echoToken, kind: "HotelAvailNotifRQ", changes: { inventory }, now: NOW };
      expect(await storeInbound(db, message)).toBe("stored");
      expect(await storeInbound(db, { ...message, changes: { inventory: [] }, now: seconds(30) })).toBe("duplicate");

      const { rows } = await db.query(`SELECT kind, changes, received_at, processed_at, attempts FROM siteminder.inbox WHERE echo_token = $1`, [echoToken]);
      expect(rows).toEqual([{ kind: "HotelAvailNotifRQ", changes: { inventory }, received_at: NOW, processed_at: null, attempts: 0 }]);
    });
  });

  it("treats EchoTokens case-insensitively (they are UUIDs)", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const echoToken = crypto.randomUUID();
      const message = { installationId: reg.installationId, echoToken, kind: "HotelAvailNotifRQ", changes: { inventory }, now: NOW };
      expect(await storeInbound(db, message)).toBe("stored");
      expect(await storeInbound(db, { ...message, echoToken: echoToken.toUpperCase() })).toBe("duplicate");
    });
  });
});

describe.skipIf(skipDbTests)("inboxHealth (rolled back)", () => {
  it("reports depth and the age of the oldest unprocessed row of active installations", async () => {
    await withTestDb(async (db) => {
      const empty = await inboxHealth(db, NOW);
      await upsertInstallation(db, reg);
      const store = (now: Date) =>
        storeInbound(db, { installationId: reg.installationId, echoToken: crypto.randomUUID(), kind: "HotelAvailNotifRQ", changes: { inventory }, now });

      await store(seconds(-90));
      await store(seconds(-30));
      const health = await inboxHealth(db, NOW);
      expect(health.inboxDepth).toBe(empty.inboxDepth + 2);
      expect(health.oldestUnprocessedSeconds).toBeGreaterThanOrEqual(90);

      // Processed rows do not count; nor do rows of a removed installation.
      await db.query(`UPDATE siteminder.inbox SET processed_at = $2 WHERE installation_id = $1 AND received_at = $3`, [reg.installationId, NOW, seconds(-90)]);
      expect((await inboxHealth(db, NOW)).inboxDepth).toBe(empty.inboxDepth + 1);
      await removeInstallation(db, reg.installationId);
      expect((await inboxHealth(db, NOW)).inboxDepth).toBe(empty.inboxDepth);
    });
  });
});
