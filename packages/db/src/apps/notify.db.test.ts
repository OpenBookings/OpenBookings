/** The doorbell on booking changes (0060). */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { connectApp } from "./installations";
import { doorbellFromEnv, notifyBookingChanged } from "./notify";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";

describeWithDb("doorbell on booking changes", () => {
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

  async function bookingAt(connected: boolean) {
    const ids = await seedProperty(db);
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-05-01", nights: 2 });
    const installation = connected
      ? (
          await connectApp(db, {
            propertyId: ids.propertyId,
            appKey: "siteminder",
            userId: "test-host-user",
            sendUpcoming: false,
            now: new Date("2031-03-01T12:00:00Z"),
          })
        ).installation
      : null;
    return { bookingId, installation };
  }

  test("rings once with the installation id for a managed property", async () => {
    const { bookingId, installation } = await bookingAt(true);
    const rings: string[][] = [];
    await notifyBookingChanged(db, bookingId, { ring: async (id, app) => void rings.push([id, app]) });
    expect(rings).toEqual([[installation!.id, "siteminder"]]);
  });

  test("does not ring for an unmanaged property", async () => {
    const { bookingId } = await bookingAt(false);
    const rings: string[][] = [];
    await notifyBookingChanged(db, bookingId, { ring: async (id, app) => void rings.push([id, app]) });
    expect(rings).toEqual([]);
  });

  test("resolves when the ring rejects", async () => {
    const { bookingId } = await bookingAt(true);
    const warn = console.warn;
    console.warn = () => {};
    try {
      await expect(
        notifyBookingChanged(db, bookingId, {
          ring: async () => {
            throw new Error("qstash down");
          },
        }),
      ).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
  });

  test("resolves for a booking that does not exist", async () => {
    await expect(
      notifyBookingChanged(db, "00000000-0000-0000-0000-000000000000", {
        ring: async () => {
          throw new Error("must not ring");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

test("doorbellFromEnv is null without QStash or the app URL", () => {
  expect(doorbellFromEnv({})).toBeNull();
  expect(doorbellFromEnv({ QSTASH_TOKEN: "t" })).toBeNull();
  expect(doorbellFromEnv({ APP_SITEMINDER_URL: "https://sm.example" })).toBeNull();
});

test("doorbellFromEnv publishes to QStash for the app's doorbell", async () => {
  const ring = doorbellFromEnv({ QSTASH_TOKEN: "t", APP_SITEMINDER_URL: "https://sm.example/" });
  expect(ring).not.toBeNull();
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await ring!("inst-1", "siteminder");
  } finally {
    globalThis.fetch = original;
  }
  expect(calls).toEqual(["https://qstash.upstash.io/v2/publish/https://sm.example/doorbell"]);
});
