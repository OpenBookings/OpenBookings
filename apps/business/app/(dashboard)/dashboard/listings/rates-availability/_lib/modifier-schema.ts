import { z } from "zod";

/**
 * A pricing rule as the host words it, turned into a `rate_modifiers` row.
 *
 * Hosts pick a kind and say "up" or "down" by an amount; the sign and the
 * trigger condition are derived here, so the pricing engine never sees a
 * rule it reads differently from how it was entered. Discount kinds always
 * go down: the database refuses a positive one (0041). Anything that lowers
 * the price is a percentage; a fixed amount is only a per-night surcharge
 * (0042).
 */

export const RULE_KINDS = ["weekend", "length_of_stay", "early_bird", "last_minute"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

const MODIFIER_TYPE: Record<RuleKind, "day_of_week" | "length_of_stay" | "early_bird" | "last_minute"> = {
  weekend: "day_of_week",
  length_of_stay: "length_of_stay",
  early_bird: "early_bird",
  last_minute: "last_minute",
};

const DISCOUNT_KINDS = new Set<RuleKind>(["length_of_stay", "early_bird"]);

export const RULE_LIMITS = {
  percent: { min: 1, max: 90 },
  flat: { min: 1, max: 9999 },
  minNights: { min: 2, max: 60 },
  daysBeforeArrival: { min: 1, max: 365 },
  daysTillArrival: { min: 0, max: 30 },
} as const;

/** A whole number from a form field, or NaN when it isn't one. */
const whole = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
};

const inRange = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;

export const modifierSchema = z
  .object({
    kind: z.enum(RULE_KINDS, { error: "Pick what the rule is for." }),
    direction: z.enum(["up", "down"]).catch("up"),
    adjustmentType: z.enum(["percent", "flat"], { error: "Choose a percentage or an amount." }),
    // Read and checked per kind below; a kind's other fields may be absent.
    amount: z.unknown().optional(),
    daysOfWeek: z.array(z.unknown()).catch([]),
    minNights: z.unknown().optional(),
    daysBeforeArrival: z.unknown().optional(),
    daysTillArrival: z.unknown().optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    const lowers = DISCOUNT_KINDS.has(v.kind) || v.direction === "down";
    if (lowers && v.adjustmentType === "flat") issue("adjustmentType", "A discount is a percentage.");

    const amount = whole(v.amount);
    const limits = RULE_LIMITS[v.adjustmentType];
    if (!inRange(amount, limits)) {
      issue(
        "amount",
        v.adjustmentType === "percent" && amount > limits.max
          ? `A percentage can be at most ${limits.max}.`
          : `Enter a whole number from ${limits.min} to ${limits.max}.`,
      );
    }

    if (v.kind === "weekend") {
      const days = v.daysOfWeek.map(whole);
      if (days.length === 0) issue("daysOfWeek", "Pick at least one day.");
      else if (days.some((d) => !inRange(d, { min: 0, max: 6 }))) issue("daysOfWeek", "Pick days of the week.");
    }
    if (v.kind === "length_of_stay" && !inRange(whole(v.minNights), RULE_LIMITS.minNights)) {
      issue("minNights", `Stays of at least ${RULE_LIMITS.minNights.min} nights.`);
    }
    if (v.kind === "early_bird" && !inRange(whole(v.daysBeforeArrival), RULE_LIMITS.daysBeforeArrival)) {
      const r = RULE_LIMITS.daysBeforeArrival;
      issue("daysBeforeArrival", `Enter ${r.min} to ${r.max} days.`);
    }
    if (v.kind === "last_minute" && !inRange(whole(v.daysTillArrival), RULE_LIMITS.daysTillArrival)) {
      const r = RULE_LIMITS.daysTillArrival;
      issue("daysTillArrival", `Enter ${r.min} to ${r.max} days.`);
    }
  })
  .transform((v) => {
    const down = DISCOUNT_KINDS.has(v.kind) || v.direction === "down";
    const amount = whole(v.amount);
    const triggerCondition: Record<string, unknown> =
      v.kind === "weekend"
        ? { days_of_week: [...new Set(v.daysOfWeek.map(whole))].sort((a, b) => a - b) }
        : v.kind === "length_of_stay"
          ? { min_nights: whole(v.minNights) }
          : v.kind === "early_bird"
            ? { days_before_arrival: whole(v.daysBeforeArrival) }
            : { days_till_arrival: whole(v.daysTillArrival) };
    return {
      type: MODIFIER_TYPE[v.kind],
      triggerCondition,
      adjustmentType: v.adjustmentType,
      adjustmentValue: down ? -amount : amount,
    };
  });

export type ModifierInput = z.infer<typeof modifierSchema>;
