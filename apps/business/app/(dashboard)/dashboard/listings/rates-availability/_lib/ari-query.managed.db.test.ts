/**
 * The rates grid on a property a connected app manages shows the same units
 * left as the guest side (loadStayAvailability), night by night, and its rate
 * plan cells show the app's prices and restrictions: closed where the app
 * stopped selling or sent no price, the app's CTA/CTD and stay limits, none of
 * our own rules, overrides or discount rules.
 *
 * AVAILABILITY_SQL reads "now" from the transaction's now(), which stays fixed
 * for the whole test transaction; the stay query is given that same instant.
 * Fixtures sit in 2031+ so dev data cannot interfere.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadStayAvailability } from "@openbookings/db";
import { applyAriBatch, connectApp, disconnectApp, type Installation } from "@openbookings/db/apps";
import { connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { applyPendingMigrations } from "../../_lib/pending-migrations";
import {
  AVAILABILITY_SQL,
  MODIFIERS_SQL,
  RATES_SQL,
  addDays,
  buildAvailabilityCell,
  buildRatePlan,
  type ModifierWithId,
  type RateQueryRow,
} from "./ari-query";

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
    name: "acknowledged 31 minutes ago but needs attention since: still counts",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 60 });
      await s.booking({ delivery: { status: "needs_attention", ackMinutesAgo: 31 } });
    },
    expected: [1, 1],
  },
  {
    name: "acknowledged 31 minutes ago but pending again: still counts",
    seed: async (s) => {
      await s.push({ unitsLeft: 2, minutesAgo: 60 });
      await s.booking({ delivery: { status: "pending", ackMinutesAgo: 31 } });
    },
    expected: [1, 1],
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

describeWithDb("RATES_SQL on an app-managed rate plan", () => {
  const RANGE = [CHECK_IN, LAST_NIGHT, CHECK_OUT]; // the app prices the first two
  let db: Client;
  let ownerId: string;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let installation: Installation;
  let codes: { room: string; plan: string };
  let now: Date;

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
    now = ((await db.query(`SELECT now() AS now`)).rows[0] as { now: Date }).now;

    ownerId = `test-business-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, first_name, last_name, email, "emailVerified", account_type)
       VALUES ($1, 'Test', 'Host', $2, true, 'business'::account_type)`,
      [ownerId, `${ownerId}@example.test`],
    );
    ids = await seedProperty(db);
    await db.query(`UPDATE properties SET owner_user_id = $2 WHERE id = $1`, [ids.propertyId, ownerId]);

    // Our own rules, none of which may reach a managed plan: a minimum stay
    // of 3, an override and a stop-sell on the first night, a 10% discount
    // that fires on any stay.
    await db.query(`UPDATE rate_plans SET min_stay = 3 WHERE id = $1`, [ids.ratePlanId]);
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night_cents) VALUES ($1, $2, $2, 14000)`,
      [ids.ratePlanId, CHECK_IN],
    );
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed, is_active) VALUES ($1, $2, $2, true, true)`,
      [ids.ratePlanId, CHECK_IN],
    );
    await db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, 'length_of_stay', '{"min_nights": 1}'::jsonb, 'percent', -10, true, 0)`,
      [ids.ratePlanId],
    );

    installation = (
      await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: ownerId, sendUpcoming: true, now })
    ).installation;
    codes = (
      await db.query(
        `SELECT r.channel_code AS room, p.channel_code AS plan FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
        [ids.roomId],
      )
    ).rows[0] as { room: string; plan: string };
    await apply({
      inventory: [{ roomCode: codes.room, from: CHECK_IN, to: CHECK_OUT, unitsLeft: 3 }],
      rates: [
        { ratePlanCode: codes.plan, from: CHECK_IN, to: CHECK_IN, priceCents: 18650, extraAdultCents: 2500, extraChildCents: null },
        { ratePlanCode: codes.plan, from: LAST_NIGHT, to: LAST_NIGHT, priceCents: 20000, extraAdultCents: null, extraChildCents: null },
      ],
      restrictions: [],
    });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function apply(batch: AriBatch) {
    expect((await applyAriBatch(db, installation, batch, now)).ok).toBe(true);
  }
  const restrict = (change: Omit<AriBatch["restrictions"][number], "ratePlanCode">) =>
    apply({ inventory: [], rates: [], restrictions: [{ ratePlanCode: codes.plan, ...change }] });

  /** The plan's row of the grid, built as loadAriGrid builds it. */
  async function gridPlan(stayLength = 1) {
    const end = RANGE[RANGE.length - 1]!;
    const availability = (await db.query(AVAILABILITY_SQL, [ownerId, ids.propertyId, RANGE[0], end])).rows;
    const left = new Map(availability.map((row) => [row.date as string, buildAvailabilityCell(row, null).left]));
    const rows = (await db.query(RATES_SQL, [ownerId, ids.propertyId, RANGE[0], addDays(end, stayLength - 1)])).rows as RateQueryRow[];
    const rules = (await db.query(MODIFIERS_SQL, [ownerId, ids.propertyId])).rows as { rate_plan_id: string; modifiers: ModifierWithId[] }[];
    return buildRatePlan(
      rows.filter((r) => r.rate_plan_id === ids.ratePlanId),
      rules.find((r) => r.rate_plan_id === ids.ratePlanId)?.modifiers ?? [],
      {
        stayLength,
        today: "2031-10-01",
        isVisible: (date) => RANGE.includes(date),
        available: (date) => left.get(date) ?? 0,
        roomClosure: () => null,
      },
    );
  }

  /** What the guest side says about a one-night stay arriving on each date. */
  async function guestReasons() {
    const out: string[][] = [];
    for (const date of RANGE) {
      const [room] = await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: date, checkOut: addDays(date, 1), now });
      out.push(room!.ratePlans.find((p) => p.ratePlanId === ids.ratePlanId)!.reasons);
    }
    return out;
  }

  test("the app's prices; a night without one is closed and unpriced; none of our rules apply", async () => {
    const plan = await gridPlan();
    expect(plan.cells.map((c) => c.priceCents)).toEqual([18650, 20000, null]);
    expect(plan.cells.map((c) => c.indicativePriceCents)).toEqual([18650, 20000, 0]);
    expect(plan.cells.map((c) => c.bookable)).toEqual([true, true, false]);
    expect(plan.cells.map((c) => c.primary)).toEqual([null, null, "STOP_SELL"]);
    expect(plan.cells.map((c) => c.minStay)).toEqual([1, 1, 1]);
    expect(plan.cells.every((c) => !c.hasOverride && c.appliedModifiers.length === 0)).toBe(true);
    // The rule is still listed for the editor; it just doesn't price anything.
    expect(plan.modifiers).toEqual([]);
    expect(plan.rules.map((r) => r.type)).toEqual(["length_of_stay"]);
    expect(plan.minStay).toBe(1);

    expect(await guestReasons()).toEqual([[], [], ["rate_closed"]]);
  });

  test("the app's stop-sell closes the night", async () => {
    await restrict({ from: LAST_NIGHT, to: LAST_NIGHT, closed: true });
    const plan = await gridPlan();
    expect(plan.cells.map((c) => c.bookable)).toEqual([true, false, false]);
    expect(plan.cells[1]!.primary).toBe("STOP_SELL");
    expect(plan.cells[1]!.priceCents).toBeNull();
    expect(plan.cells[1]!.indicativePriceCents).toBe(20000);
    expect((await guestReasons())[1]).toEqual(["rate_closed"]);
  });

  test("the app's closed to arrival and departure", async () => {
    await restrict({ from: CHECK_IN, to: CHECK_IN, closedToArrival: true });
    await restrict({ from: LAST_NIGHT, to: LAST_NIGHT, closedToDeparture: true });
    const plan = await gridPlan();
    expect(plan.cells[0]!.reasons.map((r) => r.code)).toEqual(["CLOSED_TO_ARRIVAL"]);
    expect(plan.cells[1]!.reasons.map((r) => r.code)).toEqual(["CLOSED_TO_DEPARTURE"]);
    expect(plan.cells.slice(0, 2).map((c) => c.bookable)).toEqual([true, true]);
    // Arriving on the 10th departs on the 11th, which is closed to departure.
    const [first] = await guestReasons();
    expect(first).toEqual(expect.arrayContaining(["closed_to_arrival", "closed_to_departure"]));
  });

  test("the app's stay limits: arrival and through, the stricter of each", async () => {
    await restrict({ from: CHECK_IN, to: CHECK_IN, minStayArrival: 2, maxStayArrival: 5 });
    await restrict({ from: LAST_NIGHT, to: LAST_NIGHT, minStayThrough: 3, maxStayArrival: 4, maxStayThrough: 2 });
    const plan = await gridPlan();
    expect(plan.cells.map((c) => [c.minStay, c.maxStay])).toEqual([
      [2, 5],
      [3, 2],
      [1, null],
    ]);
    expect(plan.cells[0]!.reasons.map((r) => [r.code, r.value])).toEqual([
      ["MIN_STAY", 2],
      ["MAX_STAY", 5],
    ]);
    const reasons = await guestReasons();
    expect(reasons[0]).toEqual(["min_stay"]);
    expect(reasons[1]).toEqual(["min_stay"]);
  });

  test("a longer probe prices on the app's nights and stops short of an unpriced one", async () => {
    const plan = await gridPlan(2);
    // 10th: €186.50 + €200.00 over two nights; 11th: the 12th has no app price, so one night.
    expect(plan.cells.map((c) => c.indicativePriceCents)).toEqual([19325, 20000, 0]);
    expect(plan.hasStayDiscount).toBe(false);
  });

  test("after disconnect, the app's last values are the hotel's own and its pricing rules apply again", async () => {
    await restrict({ from: LAST_NIGHT, to: LAST_NIGHT, closedToArrival: true });
    const managed = await gridPlan();
    const managedGuest = await guestReasons();

    await disconnectApp(db, { installationId: installation.id, now });
    const plan = await gridPlan();
    // Same nights open and closed, same units left, same arrival rule.
    expect(plan.cells.map((c) => c.bookable)).toEqual(managed.cells.map((c) => c.bookable));
    expect(plan.cells.map((c) => c.available)).toEqual(managed.cells.map((c) => c.available));
    expect(plan.cells.map((c) => c.primary)).toEqual([null, "CLOSED_TO_ARRIVAL", "STOP_SELL"]);
    expect(await guestReasons()).toEqual(managedGuest);
    // The app's prices are now overrides; the hotel's 10% rule applies to them again.
    expect(plan.cells.slice(0, 2).every((c) => c.hasOverride)).toBe(true);
    expect(plan.cells.map((c) => c.priceCents)).toEqual([16785, 18000, null]);
    // The plan's default minimum of 3 stays off on the carried nights.
    expect(plan.cells.map((c) => c.minStay)).toEqual([1, 1, 1]);
  });
});
