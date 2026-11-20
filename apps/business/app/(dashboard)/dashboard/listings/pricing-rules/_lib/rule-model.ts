import { discountLabel, isStayDiscount, type ModifierType } from "@openbookings/pricing";
import { WEEKDAYS } from "../../rates-availability/_lib/rule-copy";

/**
 * A pricing rule as the Pricing rules page shows it: one rule, possibly on
 * several rate plans. In the database it is one `rate_modifiers` row per
 * rate plan, sharing `rule_group_id` (0050); the pricing engine still reads
 * the rows one plan at a time. Client-safe: no database access here.
 */
export type RuleGroup = {
  id: string;
  type: ModifierType;
  adjustmentType: "flat" | "percent";
  /** Signed: below zero lowers the price. Whole euros or a percentage. */
  adjustmentValue: number;
  triggerCondition: Record<string, unknown>;
  active: boolean;
  /** Set for "All rate plans": rate plans added later get the rule too. */
  appliesToAll: boolean;
  ratePlanIds: string[];
  sortOrder: number;
};

/** A rate plan a rule can apply to, named the way hosts read it. */
export type PlanOption = {
  id: string;
  name: string;
  /** The plan's base rate, whole euros; 0 = not priced yet. */
  bar: number;
  roomId: string;
  roomName: string;
};

/** The two sections of the page. Discounts: one per stay. Adjustments: always. */
export type RuleSection = "discount" | "adjustment";

export function sectionOf(rule: Pick<RuleGroup, "type" | "adjustmentValue">): RuleSection {
  return isStayDiscount({ type: rule.type, adjustment_value: rule.adjustmentValue }) ? "discount" : "adjustment";
}

/** "+€30", "+10%", "−15%". A fixed amount is always per night. */
export function amountLabel(rule: Pick<RuleGroup, "adjustmentType" | "adjustmentValue">): string {
  const sign = rule.adjustmentValue < 0 ? "−" : "+";
  const amount = Math.abs(rule.adjustmentValue);
  return rule.adjustmentType === "percent" ? `${sign}${amount}%` : `${sign}€${amount}`;
}

/** When the rule fires: "Fri, Sat · per night", "Stays of 7+ nights"… */
export function whenLabel(rule: Pick<RuleGroup, "type" | "triggerCondition" | "adjustmentType">): string {
  const tc = rule.triggerCondition;
  switch (rule.type) {
    case "day_of_week": {
      const days = new Set(((tc.days_of_week as number[] | undefined) ?? []).map(Number));
      const names = WEEKDAYS.filter((w) => days.has(w.day)).map((w) => w.short).join(", ");
      return rule.adjustmentType === "flat" ? `${names} · per night` : names;
    }
    case "length_of_stay":
      return `Stays of ${Number(tc.min_nights)}+ nights`;
    case "early_bird":
      return `Booked ${Number(tc.days_before_arrival)}+ days before arrival`;
    case "last_minute": {
      const days = Number(tc.days_till_arrival);
      if (days === 0) return "Booked on the day of arrival";
      return `Booked ${days} ${days === 1 ? "day" : "days"} or less before arrival`;
    }
    default:
      return "Extra guests";
  }
}

/** What a guest sees at checkout for a discount; null for a price adjustment. */
export function guestLabel(rule: Pick<RuleGroup, "type" | "triggerCondition" | "adjustmentValue">): string | null {
  if (sectionOf(rule) !== "discount") return null;
  return discountLabel({ type: rule.type, trigger_condition: rule.triggerCondition });
}

/** "All rate plans", or the plans by room: "Deluxe · Flexible, Superior · Flexible". */
export function scopeLabel(rule: Pick<RuleGroup, "appliesToAll" | "ratePlanIds">, plans: PlanOption[]): string {
  if (rule.appliesToAll) return "All rate plans";
  const chosen = new Set(rule.ratePlanIds);
  const names = plans.filter((p) => chosen.has(p.id)).map((p) => `${p.roomName} · ${p.name}`);
  return names.length > 0 ? names.join(", ") : "No rate plans";
}

/** Rate plans grouped by room, in the order given, for the "Choose rate plans" list. */
export function plansByRoom(plans: PlanOption[]): { roomId: string; roomName: string; plans: PlanOption[] }[] {
  const rooms = new Map<string, { roomId: string; roomName: string; plans: PlanOption[] }>();
  for (const plan of plans) {
    const room = rooms.get(plan.roomId) ?? { roomId: plan.roomId, roomName: plan.roomName, plans: [] };
    room.plans.push(plan);
    rooms.set(plan.roomId, room);
  }
  return [...rooms.values()];
}

export const PRICING_RULES_PATH = "/dashboard/listings/pricing-rules";

/** The longest stay "Try a stay" prices. */
export const TRY_STAY_MAX_NIGHTS = 30;
