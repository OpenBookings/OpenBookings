import { describe, expect, test } from "bun:test";
import type { PinnedAccess } from "@/lib/current-property";
import type { RuleGroupForm } from "./rule-group-schema";
import { deleteRuleGroup, saveRuleGroup, setRuleGroupActive, type RuleGroupDeps } from "./mutations";

/**
 * Without a database: the refusals, which happen before any write. A rule on
 * a hotel the user can edit, but not the current one (a stale tab after a
 * switch), says so with `reason: "property-switched"`.
 */

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const owner = { user: { id: "u1", account_type: "business" } };

const weekly: RuleGroupForm = {
  section: "discount",
  kind: "length_of_stay",
  direction: "down",
  adjustmentType: "percent",
  amount: "10",
  daysOfWeek: [],
  minNights: "7",
  daysBeforeArrival: "",
  daysTillArrival: "",
  scope: "all",
  ratePlanIds: [],
};

function fakeDeps(access: PinnedAccess) {
  const writes: string[] = [];
  const deps: RuleGroupDeps = {
    tx: (fn) =>
      fn({
        query: async <T,>(sql: string) => {
          if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
          return [{ rate_plan_id: PLAN, is_active: true, property_id: PROPERTY }] as T[];
        },
      }),
    editAccess: async () => access,
    newId: () => GROUP,
  };
  return { deps, writes };
}

describe("a stale tab", () => {
  test.each([
    ["saveRuleGroup", (d: RuleGroupDeps) => saveRuleGroup(owner, { ...weekly, propertyId: PROPERTY }, d)],
    ["setRuleGroupActive", (d: RuleGroupDeps) => setRuleGroupActive(owner, GROUP, false, d)],
    ["deleteRuleGroup", (d: RuleGroupDeps) => deleteRuleGroup(owner, GROUP, d)],
  ])("%s is refused as property-switched, and nothing is written", async (_name, run) => {
    const { deps, writes } = fakeDeps("property-switched");
    expect(await run(deps)).toEqual({ ok: false, error: "Rule not found", reason: "property-switched" });
    expect(writes).toEqual([]);
  });

  test("a plain refusal carries no reason", async () => {
    const { deps } = fakeDeps("denied");
    expect(await deleteRuleGroup(owner, GROUP, deps)).toEqual({ ok: false, error: "Rule not found" });
  });
});
