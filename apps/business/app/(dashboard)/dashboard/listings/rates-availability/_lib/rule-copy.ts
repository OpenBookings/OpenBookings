import type { ModifierType } from "@openbookings/pricing";
import type { RuleKind } from "./modifier-schema";

/**
 * A pricing rule as the rules editor lists it: a `rate_modifiers` row,
 * active or not. Only active rules reach the pricing engine.
 */
export type PricingRule = {
  id: string;
  type: ModifierType;
  adjustmentType: "flat" | "percent";
  /** Signed: below zero lowers the price. Whole euros or a percentage. */
  adjustmentValue: number;
  triggerCondition: Record<string, unknown>;
  active: boolean;
};

/** What the editor's fields hold, as the strings modifierSchema reads. */
export type RuleFormValues = {
  kind: RuleKind;
  direction: "up" | "down";
  adjustmentType: "flat" | "percent";
  amount: string;
  daysOfWeek: string[];
  minNights: string;
  daysBeforeArrival: string;
  daysTillArrival: string;
};

/** Monday first, as hosts in Europe read a week. JS `getDay`: 0 = Sunday. */
export const WEEKDAYS = [
  { day: 1, short: "Mon" },
  { day: 2, short: "Tue" },
  { day: 3, short: "Wed" },
  { day: 4, short: "Thu" },
  { day: 5, short: "Fri" },
  { day: 6, short: "Sat" },
  { day: 0, short: "Sun" },
] as const;

const KIND_OF: Partial<Record<ModifierType, RuleKind>> = {
  day_of_week: "weekend",
  length_of_stay: "length_of_stay",
  early_bird: "early_bird",
  last_minute: "last_minute",
};

/** "+€30 per night" for a fixed amount (always per night), "−10%" for a percentage. */
function adjustment(rule: Pick<PricingRule, "adjustmentType" | "adjustmentValue">): string {
  const sign = rule.adjustmentValue < 0 ? "−" : "+";
  const amount = Math.abs(rule.adjustmentValue);
  return rule.adjustmentType === "percent" ? `${sign}${amount}%` : `${sign}€${amount} per night`;
}

/** "Fri, Sat: +€30 per night", "Stays of 7+ nights: −10%"… */
export function ruleSentence(rule: PricingRule): string {
  const tc = rule.triggerCondition;
  const when = (() => {
    switch (rule.type) {
      case "day_of_week": {
        const days = new Set((tc.days_of_week as number[] | undefined) ?? []);
        return WEEKDAYS.filter((w) => days.has(w.day)).map((w) => w.short).join(", ");
      }
      case "length_of_stay":
        return `Stays of ${Number(tc.min_nights)}+ nights`;
      case "early_bird":
        return `Booked ${Number(tc.days_before_arrival)}+ days ahead`;
      case "last_minute": {
        const days = Number(tc.days_till_arrival);
        return days === 0 ? "Booked on the day of arrival" : `Booked within ${days} ${days === 1 ? "day" : "days"} of arrival`;
      }
      default:
        return "Extra guests";
    }
  })();
  return `${when}: ${adjustment(rule)}`;
}

/** The editor's starting values: the saved rule, or a weekend surcharge for a new one. */
export function ruleForm(rule: PricingRule | null): RuleFormValues {
  if (!rule) {
    return {
      kind: "weekend",
      direction: "up",
      adjustmentType: "percent",
      amount: "",
      daysOfWeek: ["5", "6"],
      minNights: "",
      daysBeforeArrival: "",
      daysTillArrival: "",
    };
  }
  const tc = rule.triggerCondition;
  const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return {
    kind: KIND_OF[rule.type] ?? "weekend",
    direction: rule.adjustmentValue < 0 ? "down" : "up",
    adjustmentType: rule.adjustmentType,
    amount: String(Math.abs(rule.adjustmentValue)),
    daysOfWeek: ((tc.days_of_week as number[] | undefined) ?? []).map(String),
    minNights: text(tc.min_nights),
    daysBeforeArrival: text(tc.days_before_arrival),
    daysTillArrival: text(tc.days_till_arrival),
  };
}
