import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

/**
 * Every console loader reads one hotel: the current one. These run the real
 * getPropertyScopedDb over a fake @openbookings/db, so the assertion is on
 * what reaches Postgres: each statement pins `p.id = $2` and is bound
 * `[userId, propertyId, ...]`. With no current hotel a loader returns what it
 * returned for a host with no property, without asking the database at all.
 */

type Call = { sql: string; values: unknown[] };
let calls: Call[] = [];
/** What the fake answers for a statement; `undefined` → null / []. */
let answer: (sql: string) => unknown = () => undefined;

const realDb = await import("@openbookings/db");
await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    ...realDb,
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return (answer(sql) as unknown[] | undefined) ?? [];
    },
    queryOne: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return answer(sql) ?? null;
    },
  }),
});

const LISTINGS = "../app/(dashboard)/dashboard/listings";
const { loadEditorData } = await import(`${LISTINGS}/property/_lib/query`);
const { loadRoomsIndex, loadRoomEditor } = await import(`${LISTINGS}/rooms/_lib/query`);
const { loadPricingRules, loadRuleGroup } = await import(`${LISTINGS}/pricing-rules/_lib/query`);
const { priceTryStay } = await import(`${LISTINGS}/pricing-rules/_lib/try-stay`);
const { loadAriGrid } = await import(`${LISTINGS}/rates-availability/_lib/ari-query`);
const { loadHostReservations } = await import("./reservations/query");
const { countReviewsNeedingReply, loadHostReviews } = await import("./reviews/query");

const USER = "host-1";
const PROP = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";
const session = { user: { id: USER, account_type: "business" } };

/** Every statement was bound to this user and this hotel, and those that read properties pin it. */
function expectPinned() {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.values.slice(0, 2)).toEqual([USER, PROP]);
    if (/\bproperties p\b/.test(call.sql)) expect(call.sql).toContain("p.id = $2");
  }
}

beforeEach(() => {
  calls = [];
  answer = () => undefined;
});

describe("the property editor", () => {
  test("opens the current hotel", async () => {
    answer = (sql) => (sql.includes("LEFT JOIN property_content") ? { id: PROP, name: "Zeezicht", commission_rate: "0.045" } : undefined);
    expect((await loadEditorData(session, PROP))?.property.id).toBe(PROP);
    expect(calls).toHaveLength(2);
    expectPinned();
  });

  test("has no property without a current hotel", async () => {
    expect(await loadEditorData(session, null)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("rooms", () => {
  test("the index lists the current hotel's rooms", async () => {
    answer = (sql) => (sql.startsWith("SELECT p.id, p.name") ? { id: PROP, name: "Zeezicht" } : undefined);
    expect((await loadRoomsIndex(session, PROP))?.property.id).toBe(PROP);
    expect(calls).toHaveLength(2);
    expectPinned();
  });

  test("the editor only opens a room of the current hotel", async () => {
    await loadRoomEditor(session, PROP, ROOM);
    expectPinned();
    expect(calls[0].values).toEqual([USER, PROP, ROOM]);
  });

  test("nothing without a current hotel", async () => {
    expect(await loadRoomsIndex(session, null)).toBeNull();
    expect(await loadRoomEditor(session, null, ROOM)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("pricing rules", () => {
  test("load the current hotel's plans and rules", async () => {
    answer = (sql) => (sql.includes("SELECT p.id::text AS id, p.name") ? { id: PROP, name: "Zeezicht" } : undefined);
    const data = await loadPricingRules(session, PROP);
    expect(data?.property).toEqual({ id: PROP, name: "Zeezicht" });
    expect(calls).toHaveLength(3);
    expectPinned();
  });

  test("a rule of another hotel is not found", async () => {
    expect(await loadRuleGroup(session, PROP, GROUP)).toBeNull();
    expectPinned();
    expect(calls[0].values).toEqual([USER, PROP, GROUP]);
  });

  test("try a stay prices only the current hotel's plans", async () => {
    answer = (sql) => (sql.includes("rp.bar_cents::float8 AS bar_cents, r.base_occupancy") ? { id: PLAN, bar_cents: 10000, base_occupancy: 2, timezone: "Europe/Amsterdam" } : undefined);
    const input = { ratePlanId: PLAN, arrival: "2031-03-10", nights: 2, bookedOn: "2031-03-01" };
    expect((await priceTryStay(session, PROP, input)).ok).toBe(true);
    expect(calls).toHaveLength(3);
    expectPinned();
    for (const call of calls) expect(call.sql).toContain("p.id = $2");
  });

  test("nothing without a current hotel", async () => {
    expect(await loadPricingRules(session, null)).toBeNull();
    expect(await loadRuleGroup(session, null, GROUP)).toBeNull();
    const input = { ratePlanId: PLAN, arrival: "2031-03-10", nights: 2, bookedOn: "2031-03-01" };
    expect((await priceTryStay(session, null, input)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("rates & availability", () => {
  test("the grid reads the current hotel", async () => {
    answer = (sql) => (sql.startsWith("SELECT p.id, p.name, p.timezone") ? { id: PROP, name: "Zeezicht", timezone: "Europe/Amsterdam" } : undefined);
    await loadAriGrid(session, PROP, { start: "2031-03-01", end: "2031-03-07" });
    expect(calls).toHaveLength(5);
    expectPinned();
    for (const call of calls) expect(call.sql).toContain("p.id = $2");
  });
});

describe("bookings", () => {
  test("reservations are the current hotel's", async () => {
    expect(await loadHostReservations(session, PROP)).toEqual([]);
    expectPinned();
  });

  test("reviews and the sidebar count are the current hotel's", async () => {
    expect(await loadHostReviews(session, PROP)).toEqual([]);
    expect(await countReviewsNeedingReply(session, PROP)).toBe(0);
    expect(calls).toHaveLength(2);
    expectPinned();
  });

  test("nothing without a current hotel", async () => {
    expect(await loadHostReservations(session, null)).toEqual([]);
    expect(await loadHostReviews(session, null)).toEqual([]);
    expect(await countReviewsNeedingReply(session, null)).toBe(0);
    expect(calls).toEqual([]);
  });
});
