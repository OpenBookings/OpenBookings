import { afterAll, describe, expect, it, spyOn } from "bun:test";
import type { AppBooking, BookingChangesPage } from "@openbookings/apps-contract";
import { type CoreClient, CoreApiError } from "./core-client";
import type { Queryable } from "./db/migrate";
import { type AppInstallation, activeInstallations, upsertInstallation } from "./installations";
import { upsertFromFeed } from "./outbox-store";
import { pollInstallation } from "./poll";
import { skipDbTests, withTestDb } from "./testing/db-harness";
import { type TickDeps, tick } from "./tick";

const reg = {
  installationId: "5d2d1b63-7c2f-4c68-8a1f-3c7b5f8b0d81",
  propertyCode: "SM-POLL-2031",
  propertyName: "Hotel Poll",
  apiKey: "key-poll",
  coreBaseUrl: "https://core.example",
};
const other = { ...reg, installationId: "5d2d1b63-7c2f-4c68-8a1f-3c7b5f8b0d82", propertyCode: "SM-POLL2-2031", apiKey: "key-poll-2" };
const T0 = new Date("2031-04-01T08:00:00.000Z");
const B1 = "6e3e2c74-8d30-4d79-9b2a-4d8c6a9c1e91";
const B2 = "6e3e2c74-8d30-4d79-9b2a-4d8c6a9c1e92";

const booking = (bookingId: string, version: number, over: Partial<AppBooking> = {}): AppBooking => ({
  bookingId,
  reference: bookingId === B1 ? "OB-B7B0-2A1C" : "OB-C8D1-3B2D",
  version,
  cancelled: false,
  createdAt: "2031-03-01T10:00:00Z",
  modifiedAt: "2031-03-01T10:00:00Z",
  checkIn: "2031-05-01",
  checkOut: "2031-05-03",
  booker: { givenName: "Ada", surname: "Lovelace" },
  rooms: [],
  roomsTotalCents: 18650,
  touristTaxCents: 0,
  commissionCents: 840,
  ...over,
});

type Reply = BookingChangesPage | Error;
/** Core's feed: replies from a queue, recording the cursor each call sent. */
function fakeFeed(replies: Reply[]) {
  const cursors: (string | null)[] = [];
  const client = () =>
    ({
      changes: async (cursor: string | null): Promise<BookingChangesPage> => {
        cursors.push(cursor);
        const reply = replies.shift();
        if (!reply) throw new Error("unexpected extra call to core");
        if (reply instanceof Error) throw reply;
        return reply;
      },
    }) as unknown as CoreClient;
  return { cursors, client };
}

const page = (bookings: AppBooking[], nextCursor: string, hasMore = false): BookingChangesPage => ({ bookings, nextCursor, hasMore });

const mkDeps = (db: Queryable, feed: ReturnType<typeof fakeFeed>, now = T0, pollSeconds?: number): TickDeps => ({
  db, client: feed.client, now: () => now, sleep: async () => {}, pollSeconds,
});

type OutboxRow = { booking_id: string; unique_id: string; latest_version: string; status: string; attempts: number; last_error: string | null; latest: AppBooking };
const outbox = async (db: Queryable, installationId = reg.installationId) =>
  (await db.query<OutboxRow>(`SELECT booking_id, unique_id, latest_version::text, status, attempts, last_error, latest FROM siteminder.outbox WHERE installation_id = $1 ORDER BY booking_id`, [installationId])).rows;
const cursorOf = async (db: Queryable, id = reg.installationId) =>
  (await db.query<{ feed_cursor: string | null }>(`SELECT feed_cursor FROM siteminder.installations WHERE id = $1`, [id])).rows[0]?.feed_cursor;
const instOf = async (db: Queryable, id = reg.installationId): Promise<AppInstallation> => (await activeInstallations(db)).find((i) => i.id === id)!;

describe.skipIf(skipDbTests)("poll the change feed (rolled back)", () => {
  const spies = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
  ];
  afterAll(() => { for (const s of spies) s.mockRestore(); });

  it("stores the snapshot of a null cursor with unique ids and saves the returned cursor", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const feed = fakeFeed([page([booking(B1, 3), booking(B2, 1)], "900:0")]);
      expect(await pollInstallation(mkDeps(db, feed), await instOf(db))).toBe(2);
      expect(feed.cursors).toEqual([null]);
      expect(await cursorOf(db)).toBe("900:0");
      const rows = await outbox(db);
      expect(rows.map((r) => [r.unique_id, r.latest_version, r.status])).toEqual([["OBB7B02A1C", "3", "waiting"], ["OBC8D13B2D", "1", "waiting"]]);
      expect(rows[0]!.latest).toEqual(booking(B1, 3));
    });
  });

  it("reads page after page from the saved cursor until hasMore is false", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const feed = fakeFeed([page([booking(B1, 1)], "900:5", true), page([booking(B2, 2)], "900:9")]);
      expect(await pollInstallation(mkDeps(db, feed), await instOf(db))).toBe(2);
      expect(feed.cursors).toEqual([null, "900:5"]);
      expect(await cursorOf(db)).toBe("900:9");
      expect(await outbox(db)).toHaveLength(2);
    });
  });

  it("keeps the first page and its cursor when the second page fails", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const feed = fakeFeed([page([booking(B1, 1)], "900:5", true), new CoreApiError("down", "server", 500, true)]);
      await expect(pollInstallation(mkDeps(db, feed), await instOf(db))).rejects.toThrow("down");
      expect(await cursorOf(db)).toBe("900:5");
      expect(await outbox(db)).toHaveLength(1);
    });
  });

  it("does not overwrite a booking with an older version, and ignores a repeat of the same one", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const inst = await instOf(db);
      await upsertFromFeed(db, inst, booking(B1, 5, { roomsTotalCents: 100 }), T0);
      await upsertFromFeed(db, inst, booking(B1, 4, { roomsTotalCents: 200 }), T0);
      await upsertFromFeed(db, inst, booking(B1, 5, { roomsTotalCents: 300 }), T0);
      const [row] = await outbox(db);
      expect(row!.latest_version).toBe("5");
      expect(row!.latest.roomsTotalCents).toBe(100);
    });
  });

  it("sends a delivered booking with a newer version back to waiting", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const inst = await instOf(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await db.query(`UPDATE siteminder.outbox SET status = 'delivered', acked = 'committed', acked_version = 1`);
      await upsertFromFeed(db, inst, booking(B1, 2, { cancelled: true }), T0);
      const [row] = await outbox(db);
      expect(row).toMatchObject({ status: "waiting", latest_version: "2" });
      expect(row!.latest.cancelled).toBe(true);
      const { rows } = await db.query<{ acked: string; acked_version: string }>(`SELECT acked, acked_version::text FROM siteminder.outbox`);
      expect(rows[0]).toEqual({ acked: "committed", acked_version: "1" }); // what SiteMinder was told stays on record
    });
  });

  it("resets needs_attention and retrying on a newer version (clearing the retry state) but not not_sent or sending", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const inst = await instOf(db);
      const bs = [B1, B2, "6e3e2c74-8d30-4d79-9b2a-4d8c6a9c1e93", "6e3e2c74-8d30-4d79-9b2a-4d8c6a9c1e94"];
      const states = ["needs_attention", "retrying", "not_sent", "sending"];
      for (const [i, id] of bs.entries()) {
        await upsertFromFeed(db, inst, booking(id, 1, { reference: `OB-AAAA-000${i}` }), T0);
        await db.query(`UPDATE siteminder.outbox SET status = $2, attempts = 3, last_error = 'boom' WHERE booking_id = $1`, [id, states[i]]);
        await upsertFromFeed(db, inst, booking(id, 2, { reference: `OB-AAAA-000${i}` }), T0);
      }
      const rows = await outbox(db);
      expect(rows.map((r) => [r.status, r.attempts, r.last_error, r.latest_version])).toEqual([
        ["waiting", 0, null, "2"],
        ["waiting", 0, null, "2"],
        ["not_sent", 3, "boom", "2"],
        ["sending", 3, "boom", "2"],
      ]);
    });
  });

  it("keeps unique_id from the first insert", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const inst = await instOf(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await upsertFromFeed(db, inst, booking(B1, 2, { reference: "OB-ZZZZ-9999" }), T0);
      expect((await outbox(db))[0]!.unique_id).toBe("OBB7B02A1C");
    });
  });

  describe("tick", () => {
    it("polls an active installation that was never polled, then waits pollSeconds", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        const feed = fakeFeed([page([booking(B1, 1)], "1:0"), page([], "1:0")]);
        await tick(mkDeps(db, feed, T0, 60));
        expect(feed.cursors).toEqual([null]);
        await tick(mkDeps(db, feed, new Date(T0.getTime() + 59_000), 60));
        expect(feed.cursors).toEqual([null]);
        await tick(mkDeps(db, feed, new Date(T0.getTime() + 60_000), 60));
        expect(feed.cursors).toEqual([null, "1:0"]);
      });
    });

    it("polls the requested installation right away, and only that one", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        await upsertInstallation(db, other);
        const feed = fakeFeed([page([booking(B1, 1)], "1:0"), page([booking(B2, 1)], "2:0"), page([booking(B2, 2)], "2:1")]);
        await tick(mkDeps(db, feed, T0, 300)); // both polled
        expect(feed.cursors).toHaveLength(2);
        await tick(mkDeps(db, feed, new Date(T0.getTime() + 1_000), 300), { installationId: reg.installationId });
        expect(feed.cursors).toHaveLength(3);
        expect(feed.cursors[2]).toBe("1:0");
      });
    });

    it("does not poll when pollSeconds is not set", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        const feed = fakeFeed([]);
        await tick(mkDeps(db, feed, T0), { installationId: reg.installationId });
        expect(feed.cursors).toEqual([]);
      });
    });

    it("leaves the cursor alone on a core error, and still polls the others and works the inbox", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        await upsertInstallation(db, other);
        await db.query(`UPDATE siteminder.installations SET feed_cursor = 'old:1' WHERE id = $1`, [reg.installationId]);
        const calls: string[] = [];
        const writes: string[] = [];
        const clientFor = (inst: AppInstallation) =>
          ({
            changes: async () => {
              calls.push(inst.id);
              if (inst.id === reg.installationId) throw new CoreApiError("core down", "network", null, true);
              return page([booking(B2, 1)], "2:0");
            },
            writeAri: async () => { writes.push(inst.id); return { ok: true, nights: 1 }; },
          }) as unknown as CoreClient;
        await db.query(
          `INSERT INTO siteminder.inbox (installation_id, echo_token, kind, changes, received_at) VALUES ($1, gen_random_uuid(), 'HotelAvailNotifRQ', $2::jsonb, $3)`,
          [reg.installationId, JSON.stringify({ inventory: [{ roomCode: "RA", from: "2031-05-01", to: "2031-05-01", unitsLeft: 1 }] }), T0.toISOString()],
        );
        const result = await tick({ db, client: clientFor, now: () => T0, sleep: async () => {}, pollSeconds: 60 });
        expect(calls.sort()).toEqual([reg.installationId, other.installationId].sort());
        expect(await cursorOf(db)).toBe("old:1");
        expect(await cursorOf(db, other.installationId)).toBe("2:0");
        expect(await outbox(db, other.installationId)).toHaveLength(1);
        expect(writes).toEqual([reg.installationId]);
        expect(result.inboxApplied).toBe(1);
      });
    });
  });
});
