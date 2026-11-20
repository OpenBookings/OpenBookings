import { describe, expect, test } from "bun:test";
import { groupRules } from "./query";
import { amountLabel, guestLabel, plansByRoom, scopeLabel, sectionOf, whenLabel, type PlanOption, type RuleGroup } from "./rule-model";
import { parseRuleGroupForm, type RuleGroupForm } from "./rule-group-schema";

const rule = (over: Partial<RuleGroup>): RuleGroup => ({
  id: "g1",
  type: "day_of_week",
  adjustmentType: "flat",
  adjustmentValue: 30,
  triggerCondition: { days_of_week: [5, 6] },
  active: true,
  appliesToAll: true,
  ratePlanIds: ["p1"],
  sortOrder: 0,
  ...over,
});

const plans: PlanOption[] = [
  { id: "p1", name: "Flexible", bar: 185, roomId: "r1", roomName: "Deluxe" },
  { id: "p2", name: "Non-refundable", bar: 130, roomId: "r1", roomName: "Deluxe" },
  { id: "p3", name: "Flexible", bar: 240, roomId: "r2", roomName: "Superior" },
];

describe("sections", () => {
  test("discounts are length of stay, early booking and a lower last-minute price", () => {
    expect(sectionOf(rule({ type: "length_of_stay", adjustmentValue: -10 }))).toBe("discount");
    expect(sectionOf(rule({ type: "early_bird", adjustmentValue: -15 }))).toBe("discount");
    expect(sectionOf(rule({ type: "last_minute", adjustmentValue: -20 }))).toBe("discount");
  });

  test("price adjustments are day-of-week rules either way and a raised last-minute price", () => {
    expect(sectionOf(rule({}))).toBe("adjustment");
    expect(sectionOf(rule({ adjustmentType: "percent", adjustmentValue: -10 }))).toBe("adjustment");
    expect(sectionOf(rule({ type: "last_minute", adjustmentType: "percent", adjustmentValue: 10 }))).toBe("adjustment");
  });
});

describe("labels", () => {
  test("amount, when and what guests see", () => {
    expect(amountLabel(rule({}))).toBe("+€30");
    expect(whenLabel(rule({}))).toBe("Fri, Sat · per night");
    expect(guestLabel(rule({}))).toBeNull();

    const weekly = rule({ type: "length_of_stay", adjustmentType: "percent", adjustmentValue: -10, triggerCondition: { min_nights: 7 } });
    expect(amountLabel(weekly)).toBe("−10%");
    expect(whenLabel(weekly)).toBe("Stays of 7+ nights");
    expect(guestLabel(weekly)).toBe("Weekly discount");

    const lastMinute = rule({ type: "last_minute", adjustmentType: "percent", adjustmentValue: -20, triggerCondition: { days_till_arrival: 3 } });
    expect(whenLabel(lastMinute)).toBe("Booked 3 days or less before arrival");
    expect(guestLabel(lastMinute)).toBe("Last-minute discount");
    expect(whenLabel({ ...lastMinute, triggerCondition: { days_till_arrival: 0 } })).toBe("Booked on the day of arrival");
  });

  test("scope reads as all plans, or the chosen plans by room", () => {
    expect(scopeLabel(rule({}), plans)).toBe("All rate plans");
    expect(scopeLabel(rule({ appliesToAll: false, ratePlanIds: ["p1", "p3"] }), plans)).toBe(
      "Deluxe · Flexible, Superior · Flexible",
    );
  });

  test("plans are grouped by room for the checklist", () => {
    expect(plansByRoom(plans).map((r) => [r.roomName, r.plans.length])).toEqual([
      ["Deluxe", 2],
      ["Superior", 1],
    ]);
  });
});

describe("groupRules", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "m1",
    rule_group_id: "g1",
    rate_plan_id: "p1",
    type: "day_of_week" as const,
    adjustment_type: "flat" as const,
    adjustment_value: "30",
    trigger_condition: { days_of_week: [5, 6] },
    is_active: true,
    applies_to_all: false,
    sort_order: 0,
    ...over,
  });

  test("rows of one group become one rule on several plans", () => {
    const rules = groupRules([
      row({}),
      row({ id: "m2", rate_plan_id: "p2", sort_order: 3 }),
      row({ id: "m3", rule_group_id: "g2", type: "length_of_stay", adjustment_type: "percent", adjustment_value: "-10", sort_order: 1 }),
    ]);
    expect(rules.map((r) => [r.id, r.ratePlanIds, r.adjustmentValue])).toEqual([
      ["g1", ["p1", "p2"], 30],
      ["g2", ["p1"], -10],
    ]);
  });
});

describe("parseRuleGroupForm", () => {
  const form = (over: Partial<RuleGroupForm>): RuleGroupForm => ({
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
    ...over,
  });
  const PLAN = "11111111-1111-4111-8111-111111111111";

  test("a discount is stored negative, on all plans", () => {
    const r = parseRuleGroupForm(form({}));
    expect(r.ok && r.data).toMatchObject({ type: "length_of_stay", adjustmentValue: -10, appliesToAll: true, ratePlanIds: [] });
  });

  test("a last-minute rule lowers under Discounts and raises under Price adjustments, whatever was sent", () => {
    const discount = parseRuleGroupForm(form({ kind: "last_minute", direction: "up", daysTillArrival: "3" }));
    expect(discount.ok && discount.data.adjustmentValue).toBe(-10);
    const adjustment = parseRuleGroupForm(
      form({ section: "adjustment", kind: "last_minute", direction: "down", daysTillArrival: "3", scope: "some", ratePlanIds: [PLAN] }),
    );
    expect(adjustment.ok && adjustment.data).toMatchObject({ adjustmentValue: 10, appliesToAll: false, ratePlanIds: [PLAN] });
  });

  test("a kind from the other section is refused", () => {
    expect(parseRuleGroupForm(form({ kind: "weekend", daysOfWeek: ["5"] })).ok).toBe(false);
    expect(parseRuleGroupForm(form({ section: "adjustment", kind: "early_bird", daysBeforeArrival: "30" })).ok).toBe(false);
  });

  test("a lower day-of-week price must be a percentage", () => {
    const r = parseRuleGroupForm(form({ section: "adjustment", kind: "weekend", direction: "down", adjustmentType: "flat", daysOfWeek: ["5"] }));
    expect(r.ok).toBe(false);
  });

  test("choosing rate plans needs at least one", () => {
    const r = parseRuleGroupForm(form({ scope: "some", ratePlanIds: [] }));
    expect(!r.ok && r.errors.ratePlanIds?.[0]).toBe("Choose at least one rate plan.");
  });
});
