/**
 * Prices on a rate plan a connected app manages (spec §2: Discount rules off,
 * Rates, Extra guest fees come from SiteMinder): the app's nightly price is the
 * price, to the cent; our BAR, overrides and discount rules don't touch it; the
 * app's extra-guest fees replace the room's. A night the app sent no price for
 * is never priced from our own numbers. Every test runs in a transaction that
 * is rolled back; fixtures sit in 2031+.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { applyAriBatch, connectApp, type Installation } from "@openbookings/db/apps";
import { getDb } from "@openbookings/db";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import { buildPropertyPageQuery } from "@/lib/hotel-page-data";
import { withAllInPrices, withCancellationTerms } from "@/lib/listing-prices";
import { priceSelection, priceTonight, quoteStay, type SelectedRoom } from "./quote";

const CHECK_IN = "2031-11-10";
const LAST_NIGHT = "2031-11-11";
const CHECK_OUT = "2031-11-12"; // 2 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const STAY = { checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, infants: 0, rooms: 1 };

type AriBatch = Parameters<typeof applyAriBatch>[2];
/** drizzle's own rendering of a query, so the page data SQL runs in the test transaction. */
type Rendering = { dialect: { sqlToQuery: (q: ReturnType<typeof buildPropertyPageQuery>) => { sql: string; params: unknown[] } } };
type Ids = { propertyId: string; roomId: string; ratePlanId: string };

describeWithDb("stay quote on an app-managed rate plan", () => {
  let db: Client;
  let ids: Ids;
  let installation: Installation;
  let codes: { room: string; plan: string };

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
    ids = await seedProperty(db);
    // Our own pricing, which must not reach a managed plan: a BAR, an
    // override on the first night, a 10% discount from 2 nights, a room fee.
    await ourOwnPricing(ids);
    installation = (
      await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now: NOW })
    ).installation;
    codes = (
      await db.query(
        `SELECT r.channel_code AS room, p.channel_code AS plan FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
        [ids.roomId],
      )
    ).rows[0] as { room: string; plan: string };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function ourOwnPricing(p: Ids) {
    await db.query(`UPDATE rooms SET max_adults = 3, extra_adult_fee_cents = 2000 WHERE id = $1`, [p.roomId]);
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night_cents) VALUES ($1, $2, $2, 14000)`,
      [p.ratePlanId, CHECK_IN],
    );
    await db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, 'length_of_stay', '{"min_nights": 2}'::jsonb, 'percent', -10, true, 0)`,
      [p.ratePlanId],
    );
  }

  /** The app's numbers: 3 units left each night, €186.50 then €200.00, extra fees as given. */
  async function push(i: { extraAdult?: [number | null, number | null]; nights?: string[] } = {}) {
    const [first, second] = i.extraAdult ?? [null, null];
    const nights = i.nights ?? [CHECK_IN, LAST_NIGHT];
    const rate = (date: string, priceCents: number, extraAdultCents: number | null) => ({
      ratePlanCode: codes.plan,
      from: date,
      to: date,
      priceCents,
      extraAdultCents,
      extraChildCents: null,
    });
    const batch: AriBatch = {
      inventory: [{ roomCode: codes.room, from: CHECK_IN, to: LAST_NIGHT, unitsLeft: 3 }],
      rates: [rate(CHECK_IN, 18650, first), rate(LAST_NIGHT, 20000, second)].filter((r) => nights.includes(r.from)),
      restrictions: [],
    };
    expect((await applyAriBatch(db, installation, batch, NOW)).ok).toBe(true);
  }

  const quote = (stay = STAY, propertyId = ids.propertyId) => quoteStay(db, { propertyId, stay, now: NOW, testing: false });
  const select = (over: Partial<SelectedRoom> = {}) =>
    priceSelection(db, {
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      now: NOW,
      testing: false,
      selection: [{ roomId: ids.roomId, ratePlanId: ids.ratePlanId, adults: 2, children: 0, infants: 0, cots: 0, extraBeds: 0, ...over }],
    });

  test("the app's €186.50 and €200.00 are the nightly prices, to the cent, untouched by our discount and override", async () => {
    await push();
    const plan = (await quote())!.rooms[0].ratePlans[0];
    expect(plan.nights).toEqual([
      { date: CHECK_IN, priceCents: 18650 },
      { date: LAST_NIGHT, priceCents: 20000 },
    ]);
    expect(plan.stayTotalCents).toBe(38650);
    expect(plan.totalCents).toBe(38650);
    expect(plan.discount).toBeNull();
    expect(plan.reasons).toEqual([]);
  });

  test("the booking snapshot carries €186.50 exactly", async () => {
    await push();
    const result = await select();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [room] = result.rooms;
    expect(room.nights).toEqual([
      { date: CHECK_IN, priceCents: 18650 },
      { date: LAST_NIGHT, priceCents: 20000 },
    ]);
    expect(room.rateNights.map((n) => n.priceCents)).toEqual([18650, 20000]);
    expect(room.discount).toBeNull();
    expect(result.snapshot.roomsTotalCents).toBe(38650);
  });

  test("an extra adult pays the app's fee each night, not the room's", async () => {
    await push({ extraAdult: [2500, 3000] });
    const plan = (await quote({ ...STAY, adults: 3 }))!.rooms[0].ratePlans[0];
    expect(plan.nights.map((n) => n.priceCents)).toEqual([18650 + 2500, 20000 + 3000]);
    expect(plan.stayTotalCents).toBe(44150);

    const result = await select({ adults: 3 });
    expect(result.ok && result.rooms[0].extraGuests).toEqual([
      { kind: "adult", count: 1, perNightCents: 2500, nights: 1, amountCents: 2500 },
      { kind: "adult", count: 1, perNightCents: 3000, nights: 1, amountCents: 3000 },
    ]);
  });

  test("no extra fee from the app means none, whatever the room says", async () => {
    await push();
    expect((await quote({ ...STAY, adults: 3 }))!.rooms[0].ratePlans[0].stayTotalCents).toBe(38650);
  });

  test("a night the app sent no price for is never priced from our BAR or overrides", async () => {
    await push({ nights: [CHECK_IN] });
    // The plan is left out of the quote, as a plan that isn't offered is; the
    // page hides whatever the quote does not mention.
    const q = (await quote())!;
    expect(q.rooms.flatMap((r) => r.ratePlans)).toEqual([]);

    const result = await select();
    expect(result.ok).toBe(false);

    // The night it did price still sells on its own.
    const oneNight = (await quote({ ...STAY, checkOut: LAST_NIGHT }))!.rooms[0].ratePlans[0];
    expect(oneNight.nights).toEqual([{ date: CHECK_IN, priceCents: 18650 }]);
  });

  test("tonight's listing price is the app's, or none", async () => {
    // NOW is 2031-10-01 at the property; the app prices that night only.
    const tonight = "2031-10-01";
    const batch: AriBatch = {
      inventory: [{ roomCode: codes.room, from: tonight, to: tonight, unitsLeft: 3 }],
      rates: [{ ratePlanCode: codes.plan, from: tonight, to: tonight, priceCents: 18650, extraAdultCents: null, extraChildCents: null }],
      restrictions: [],
    };
    expect((await applyAriBatch(db, installation, batch, NOW)).ok).toBe(true);
    expect((await priceTonight(db, { id: ids.propertyId, timezone: "Europe/Amsterdam" }, NOW))[ids.ratePlanId]).toEqual({
      priceCents: 18650,
      sellable: true,
      managed: true,
    });

    const later = new Date("2031-10-02T10:00:00Z");
    expect((await priceTonight(db, { id: ids.propertyId, timezone: "Europe/Amsterdam" }, later))[ids.ratePlanId]).toEqual({
      priceCents: null,
      sellable: false,
      managed: true,
    });
  });

  describe("the listing without dates", () => {
    const TONIGHT = "2031-10-01"; // NOW at the property
    // A BAR no other number in the output can be mistaken for.
    const BAR = 12345;

    /** The page's rooms as the property page renders them: page data, tonight's prices, B.4. */
    async function listing() {
      await db.query(`UPDATE rate_plans SET bar_cents = $2 WHERE id = $1`, [ids.ratePlanId, BAR]);
      const { slug } = (await db.query(`SELECT slug FROM properties WHERE id = $1`, [ids.propertyId])).rows[0] as { slug: string };
      const page = (getDb() as unknown as Rendering).dialect.sqlToQuery(buildPropertyPageQuery(slug));
      const [row] = (await db.query(page.sql, page.params)).rows as { page_rooms: DbRoom[] }[];
      const tonight = await priceTonight(db, { id: ids.propertyId, timezone: "Europe/Amsterdam" }, NOW);
      return { pageRooms: row!.page_rooms, rooms: withCancellationTerms(withAllInPrices(row!.page_rooms, [], TONIGHT, tonight), "standard") };
    }

    async function priceTonightAt(priceCents: number | null, restrictions: AriBatch["restrictions"] = []) {
      const batch: AriBatch = {
        inventory: [{ roomCode: codes.room, from: TONIGHT, to: TONIGHT, unitsLeft: 3 }],
        rates:
          priceCents === null
            ? []
            : [{ ratePlanCode: codes.plan, from: TONIGHT, to: TONIGHT, priceCents, extraAdultCents: null, extraChildCents: null }],
        restrictions,
      };
      expect((await applyAriBatch(db, installation, batch, NOW)).ok).toBe(true);
    }

    test("the page data says the plan is managed", async () => {
      const { pageRooms } = await listing();
      expect(pageRooms[0]!.rate_plans[0]).toMatchObject({ id: ids.ratePlanId, managed: true });
    });

    test("closed to arrival tonight: the app's price, as \"from\", never our BAR", async () => {
      await priceTonightAt(18650, [{ ratePlanCode: codes.plan, from: TONIGHT, to: TONIGHT, closedToArrival: true }]);
      const { rooms } = await listing();
      const plan = rooms[0]!.rate_plans[0]!;
      expect(plan).toMatchObject({ id: ids.ratePlanId, price_per_night_cents: 18650, price_from: true, managed: true });
      expect(plan.bar_cents).toBeUndefined();
      expect(JSON.stringify(rooms)).not.toContain(String(BAR));
    });

    test("no app price tonight: no price at all, and no BAR anywhere", async () => {
      await priceTonightAt(null);
      const { rooms } = await listing();
      const plan = rooms[0]!.rate_plans[0]!;
      expect(plan.price_per_night_cents).toBeNull();
      expect(plan.price_from).toBeUndefined();
      expect(plan.bar_cents).toBeUndefined();
      expect(JSON.stringify(rooms)).not.toContain(String(BAR));
    });
  });

  test("an unmanaged property with the same rules is priced as before", async () => {
    await push();
    const other = await seedProperty(db);
    await ourOwnPricing(other);
    const plan = (await quote(STAY, other.propertyId))!.rooms[0].ratePlans[0];
    // Override 14000 then BAR 10000, 10% off each night; extra adult at the room's 2000.
    expect(plan.nights.map((n) => n.priceCents)).toEqual([12600, 9000]);
    expect(plan.discount?.amountCents).toBe(2400);
    const threeAdults = (await quote({ ...STAY, adults: 3 }, other.propertyId))!.rooms[0].ratePlans[0];
    expect(threeAdults.nights.map((n) => n.priceCents)).toEqual([14600, 11000]);
  });
});
