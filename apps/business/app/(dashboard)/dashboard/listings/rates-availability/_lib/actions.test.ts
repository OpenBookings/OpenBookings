import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

/**
 * Prices reach these actions as the text a host typed ("89,50", "120.25") and
 * are read into cents on the server. The fake database records what would be
 * written, so the assertion is on the cents that reach Postgres.
 */

type Call = { sql: string; values: unknown[] };
let calls: Call[] = [];

const PROP = "11111111-1111-4111-8111-111111111111";
const PLAN = "44444444-4444-4444-8444-444444444444";

const record = async (sql: string, values: unknown[] = []) => {
  calls.push({ sql, values });
  if (sql.includes("RETURNING room_id")) return [{ room_id: "room-1" }];
  if (sql.includes("AS version")) return [{ version: "v1" }];
  return [{ id: "row-1" }];
};

const realDb = await import("@openbookings/db");
const realAuthz = await import("@openbookings/authz");
await mockModules(
  import.meta.dir,
  {
    "next/cache": () => ({ revalidatePath: () => {} }),
    "next/headers": () => ({ headers: async () => new Headers() }),
    "@/lib/purge-property-page": () => ({ purgePropertyPage: async () => {} }),
    "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => ({ user: { id: "host-1" }, session: { id: "s1" } }) }),
    "@/lib/current-property": () => ({
      currentPropertyPin: async () => ({ currentPropertyId: PROP }),
      pinnedAccess: async () => "ok",
      switchedReason: () => ({}),
    }),
    "@openbookings/authz": () => ({
      ...realAuthz,
      ratePlanRatesConfirmed: async () => true,
      roomRatesConfirmed: async () => true,
      userOwnsRatePlan: async () => true,
      userOwnsRoom: async () => true,
    }),
    "@openbookings/db": () => ({
      ...realDb,
      query: record,
      withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
        fn({
          query: async (sql: string, values: unknown[] = []) => {
            const rows = await record(sql, values);
            return { rows, rowCount: rows.length };
          },
        }),
    }),
  },
  ["@/lib/auth"],
);

const { publishAriChanges, setBaseRate, createRatePlan } = await import("./actions");

beforeEach(() => {
  calls = [];
});

describe("setBaseRate", () => {
  test('"89,50" stores bar_cents 8950', async () => {
    expect(await setBaseRate({ ratePlanId: PLAN, bar: "89,50" })).toEqual({ ok: true, affected: 1 });
    const update = calls.find((c) => c.sql.includes("UPDATE rate_plans SET bar_cents"));
    expect(update?.values).toEqual([8950, PLAN]);
  });

  test("text that is not an amount is refused before anything is written", async () => {
    expect(await setBaseRate({ ratePlanId: PLAN, bar: "89.505" })).toEqual({ ok: false, error: "Use at most two decimals, without a thousands separator" });
    expect(await setBaseRate({ ratePlanId: PLAN, bar: "1.234,50" })).toMatchObject({ ok: false });
    expect(await setBaseRate({ ratePlanId: PLAN, bar: "0" })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("createRatePlan", () => {
  test("the base rate is read into cents", async () => {
    const input = { roomId: "22222222-2222-4222-8222-222222222222", name: "Flexible", bar: "99.99", currency: "EUR" as const, isRefundable: true, minStay: 1, maxStay: null };
    expect(await createRatePlan(input)).toEqual({ ok: true, affected: 1 });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO rate_plans"));
    expect(insert?.sql).toContain("bar_cents");
    expect(insert?.values[2]).toBe(9999);
  });
});

describe("publishAriChanges", () => {
  const publish = (price: string | null) =>
    publishAriChanges({
      propertyId: PROP,
      from: "2031-03-01",
      to: "2031-03-31",
      version: "v1",
      changes: [{ type: "price", ratePlanId: PLAN, dates: ["2031-03-10", "2031-03-11"], price }],
    });

  test('a grid price "120.25" stores 12025', async () => {
    expect(await publish("120.25")).toMatchObject({ ok: true });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO rate_overrides"));
    expect(insert?.sql).toContain("price_per_night_cents");
    expect(insert?.values).toEqual([PLAN, null, "2031-03-10", "2031-03-11", 12025, "host-1"]);
  });

  test("clearing a price writes no override", async () => {
    expect(await publish(null)).toMatchObject({ ok: true });
    expect(calls.some((c) => c.sql.includes("INSERT INTO rate_overrides"))).toBe(false);
  });

  test("a price with three decimals is refused, and nothing is written", async () => {
    expect(await publish("120.255")).toEqual({ ok: false, error: "Use at most two decimals, without a thousands separator" });
    expect(calls).toEqual([]);
  });
});
