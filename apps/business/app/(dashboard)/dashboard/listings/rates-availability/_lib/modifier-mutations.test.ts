import { describe, expect, test } from "bun:test";
import type { SessionLike } from "@openbookings/authz";
import { deleteModifier, saveModifier, setModifierActive, type ModifierDeps } from "./modifier-mutations";

/**
 * Pricing rules are written only for a rate plan the caller owns. These run
 * without a database: the fake answers the ownership query @openbookings/authz
 * issues (`$1 = rate plan id, $2 = user`) and records every statement.
 */

const OWNER = "host-owner";
const STRANGER = "host-stranger";
const PLAN = "33333333-3333-4333-8333-333333333333";
const RULE = "44444444-4444-4444-8444-444444444444";
const ROOM = "22222222-2222-4222-8222-222222222222";

const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });

function fakeDeps() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const queryOne = async <T,>(sql: string, values: unknown[] = []): Promise<T | null> => {
    calls.push({ sql, values });
    if (/SELECT TRUE AS ok/.test(sql)) {
      const [id, userId] = values as [string, string];
      return (id === PLAN && userId === OWNER ? { ok: true } : null) as T | null;
    }
    if (/FROM rate_modifiers m/.test(sql)) {
      return (values[0] === RULE ? { rate_plan_id: PLAN } : null) as T | null;
    }
    if (/RETURNING/.test(sql)) return { id: RULE, room_id: ROOM } as T;
    return null;
  };
  const deps: ModifierDeps = { queryOne };
  const writes = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
  return { deps, writes };
}

const weekend = { kind: "weekend", direction: "up", adjustmentType: "flat", amount: "30", daysOfWeek: ["5", "6"] };

describe("a host who does not own the rate plan", () => {
  const stranger = session(STRANGER);

  test.each([
    ["saveModifier (create)", (d: ModifierDeps) => saveModifier(stranger, { ratePlanId: PLAN, ...weekend }, d)],
    ["saveModifier (update)", (d: ModifierDeps) => saveModifier(stranger, { ratePlanId: PLAN, modifierId: RULE, ...weekend }, d)],
    ["setModifierActive", (d: ModifierDeps) => setModifierActive(stranger, RULE, false, d)],
    ["deleteModifier", (d: ModifierDeps) => deleteModifier(stranger, RULE, d)],
  ])("is refused by %s, and nothing is written", async (_name, run) => {
    const { deps, writes } = fakeDeps();
    const result = await run(deps);
    expect(result.ok).toBe(false);
    expect(writes()).toEqual([]);
  });

  test("an update can't move a rule onto a plan the caller owns from one they don't", async () => {
    const { deps, writes } = fakeDeps();
    const r = await saveModifier(session(OWNER), { ratePlanId: PLAN, modifierId: "55555555-5555-4555-8555-555555555555", ...weekend }, deps);
    expect(r).toEqual({ ok: false, error: "Rule not found" });
    expect(writes()).toEqual([]);
  });
});

describe("the owner", () => {
  const owner = session(OWNER);

  test("creates a rule at the end of the plan's list, with the derived sign and condition", async () => {
    const { deps, writes } = fakeDeps();
    const r = await saveModifier(owner, { ratePlanId: PLAN, ...weekend, direction: "down", adjustmentType: "percent", amount: "10" }, deps);
    expect(r).toEqual({ ok: true, id: RULE, roomId: ROOM });
    const [insert] = writes();
    expect(insert.sql).toMatch(/INSERT INTO rate_modifiers/);
    expect(insert.values).toEqual([PLAN, "day_of_week", JSON.stringify({ days_of_week: [5, 6] }), "percent", -10]);
  });

  test("updates a rule in place", async () => {
    const { deps, writes } = fakeDeps();
    const r = await saveModifier(owner, { ratePlanId: PLAN, modifierId: RULE, ...weekend }, deps);
    expect(r.ok).toBe(true);
    const [update] = writes();
    expect(update.sql).toMatch(/UPDATE rate_modifiers/);
    expect(update.values).toEqual(["day_of_week", JSON.stringify({ days_of_week: [5, 6] }), "flat", 30, RULE]);
  });

  test("an invalid rule comes back with field errors and writes nothing", async () => {
    const { deps, writes } = fakeDeps();
    const r = await saveModifier(owner, { ratePlanId: PLAN, ...weekend, daysOfWeek: [] }, deps);
    expect(r).toMatchObject({ ok: false, errors: { daysOfWeek: ["Pick at least one day."] } });
    expect(writes()).toEqual([]);
  });

  test("switches a rule off and deletes it", async () => {
    const { deps, writes } = fakeDeps();
    expect((await setModifierActive(owner, RULE, false, deps)).ok).toBe(true);
    expect((await deleteModifier(owner, RULE, deps)).ok).toBe(true);
    expect(writes().map((w) => w.values)).toEqual([[false, RULE], [RULE]]);
  });
});
