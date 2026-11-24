/**
 * The rates grid on a property a connected app manages shows the same units
 * left as the guest side (loadStayAvailability), night by night.
 *
 * AVAILABILITY_SQL reads "now" from the transaction's now(), which stays fixed
 * for the whole test transaction; the stay query is given that same instant.
 * Fixtures sit in 2031+ so dev data cannot interfere.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadStayAvailability } from "@openbookings/db";
import { applyAriBatch, connectApp, type Installation } from "@openbookings/db/apps";
import { connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { applyPendingMigrations } from "../../_lib/pending-migrations";
import { AVAILABILITY_SQL, buildAvailabilityCell } from "./ari-query";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-12";
const LAST_NIGHT = "2031-11-11";
const MINUTE = 60_000;

type AriBatch = Parameters<typeof applyAriBatch>[2];

type Scenario = {
  name: string;
  seed: (s: Setup) => Promise<void>;
  expected: [number, number];
};

type Setup = {
  push: (i: { unitsLeft: number; minutesAgo: number; from?: string; to?: string }) => Promise<void>;
  booking: (i: { status?: string; delivery?: { status: string; ackMinutesAgo: number | null } }) => Promise<void>;
  closeRoom: () => Promise<void>;
};

const scenarios: Scenario[] = [
  {
    name: "unacknowledged booking counts",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 5 });
      await s.booking({ delivery: { status: "pending", ackMinutesAgo: null } });
    },
    expected: [1, 1],
  },
  {
    name: "acknowledged a minute ago, limit received after: still counts",
    seed: async (s) => {
      await s.booking({ delivery: { status: "delivered", ackMinutesAgo: 1 } });
      await s.push({ unitsLeft: 2, minutesAgo: 0.5 });
    },
    expected: [1, 1],
  },
  {
    name: "acknowledged 4 minutes ago, limit received 3.5 minutes after: settled",
    seed: async (s) => {
      await s.booking({ delivery: { status: "delivered", ackMinutesAgo: 4 } });
      await s.push({ unitsLeft: 2, minutesAgo: 0.5 });
    },
    expected: [2, 2],
  },
  {
    name: "acknowledged 31 minutes ago, no newer limit: settled",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 60 });
      await s.booking({ delivery: { status: "delivered", ackMinutesAgo: 31 } });
    },
    expected: [2, 2],
  },
  {
    name: "not_sent never counts",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 5 });
      await s.booking({ delivery: { status: "not_sent", ackMinutesAgo: null } });
    },
    expected: [2, 2],
  },
  {
    name: "cancelled booking does not count",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 5 });
      await s.booking({ status: "cancelled", delivery: { status: "delivered", ackMinutesAgo: 31 } });
    },
    expected: [2, 2],
  },
  {
    name: "a night the app never sent has no units",
    seed: async (s) => {
      await s.push({ unitsLeft: 3, minutesAgo: 5, from: CHECK_IN, to: CHECK_IN });
    },
    expected: [3, 0],
  },
  {
    name: "a room closure is ignored",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 5 });
      await s.closeRoom();
    },
    expected: [2, 2],
  },
];

describeWithDb("AVAILABILITY_SQL on an app-managed property", () => {
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

  for (const scenario of scenarios) {
    test(`grid matches the stay query: ${scenario.name}`, async () => {
      const now = ((await db.query(`SELECT now() AS now`)).rows[0] as { now: Date }).now;
      const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);

      const ownerId = `test-business-${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO "user" (id, first_name, last_name, email, "emailVerified", account_type)
         VALUES ($1, 'Test', 'Host', $2, true, 'business'::account_type)`,
        [ownerId, `${ownerId}@example.test`],
      );
      const ids = await seedProperty(db);
      await db.query(`UPDATE properties SET owner_user_id = $2 WHERE id = $1`, [ids.propertyId, ownerId]);
      const { installation } = (await connectApp(db, {
        propertyId: ids.propertyId,
        appKey: "siteminder",
        userId: ownerId,
        sendUpcoming: true,
        now: ago(120),
      })) as { installation: Installation };
      const codes = (
        await db.query(
          `SELECT r.channel_code AS room, p.channel_code AS plan FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
          [ids.roomId],
        )
      ).rows[0] as { room: string; plan: string };

      await scenario.seed({
        push: async ({ unitsLeft, minutesAgo, from = CHECK_IN, to = LAST_NIGHT }) => {
          const batch: AriBatch = {
            inventory: [{ roomCode: codes.room, from, to, unitsLeft }],
            rates: [{ ratePlanCode: codes.plan, from: CHECK_IN, to: LAST_NIGHT, priceCents: 12000, extraAdultCents: null, extraChildCents: null }],
            restrictions: [],
          };
          expect((await applyAriBatch(db, installation, batch, ago(minutesAgo))).ok).toBe(true);
        },
        booking: async ({ status = "confirmed", delivery }) => {
          const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
          await db.query(`UPDATE bookings SET status = $2::booking_status WHERE id = $1`, [bookingId, status]);
          if (delivery) {
            await db.query(
              `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES ($1, $2, $3, $4)`,
              [installation.id, bookingId, delivery.status, delivery.ackMinutesAgo === null ? null : ago(delivery.ackMinutesAgo)],
            );
          }
        },
        closeRoom: async () => {
          await db.query(`INSERT INTO room_closures (room_id, start_date, end_date, is_active) VALUES ($1, $2, $3, true)`, [
            ids.roomId,
            CHECK_IN,
            CHECK_OUT,
          ]);
        },
      });

      const rows = (await db.query(AVAILABILITY_SQL, [ownerId, ids.propertyId, CHECK_IN, LAST_NIGHT])).rows;
      const grid = rows.map((row) => buildAvailabilityCell(row, null).left);
      expect(rows.every((row) => row.closure_id === null)).toBe(true);

      const [room] = await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: CHECK_IN, checkOut: CHECK_OUT, now });
      expect(room!.nights.map((n) => n.bookable)).toEqual(scenario.expected);
      expect(grid).toEqual(scenario.expected);
    });
  }
});
