import { z } from "zod";
import { modifierSchema, type RuleKind } from "../../rates-availability/_lib/modifier-schema";
import type { RuleSection } from "./rule-model";

/**
 * The Pricing rules form: which section the rule is added in, the rule
 * itself (read by modifierSchema, the same one R&A used), and the rate plans
 * it applies to.
 *
 * Where a rule is added decides what it is. A lower last-minute price is a
 * discount (it competes with the other discounts, see isStayDiscount), so it
 * can only be made under Discounts; under Price adjustments last minute only
 * raises the price. A rule's section is fixed here, whatever the client sent.
 */

export const SECTION_KINDS: Record<RuleSection, readonly RuleKind[]> = {
  discount: ["length_of_stay", "early_bird", "last_minute"],
  adjustment: ["weekend", "last_minute"],
};

export type RuleGroupForm = {
  section: RuleSection;
  kind: RuleKind;
  direction: "up" | "down";
  adjustmentType: "flat" | "percent";
  amount: string;
  daysOfWeek: string[];
  minNights: string;
  daysBeforeArrival: string;
  daysTillArrival: string;
  scope: "all" | "some";
  ratePlanIds: string[];
};

export type ParsedRuleGroup = z.infer<typeof modifierSchema> & {
  appliesToAll: boolean;
  ratePlanIds: string[];
};

export type RuleGroupParse =
  | { ok: true; data: ParsedRuleGroup }
  | { ok: false; errors: Record<string, string[] | undefined> };

const scopeSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({
    scope: z.literal("some"),
    ratePlanIds: z.array(z.string().uuid()).min(1, "Choose at least one rate plan."),
  }),
]);

export function parseRuleGroupForm(input: unknown): RuleGroupParse {
  const raw = (input ?? {}) as Partial<RuleGroupForm>;
  const section: RuleSection = raw.section === "discount" ? "discount" : "adjustment";
  const errors: Record<string, string[] | undefined> = {};

  const kind = raw.kind as RuleKind | undefined;
  if (!kind || !SECTION_KINDS[section].includes(kind)) {
    errors.kind = [section === "discount" ? "Pick a kind of discount." : "Pick a kind of price adjustment."];
  }

  // Discounts only lower the price. A last-minute adjustment only raises it:
  // lowered, it is a discount and belongs in the other section.
  const direction =
    section === "discount" ? "down" : kind === "last_minute" ? "up" : raw.direction === "down" ? "down" : "up";

  const rule = modifierSchema.safeParse({ ...raw, kind, direction });
  if (!rule.success) Object.assign(errors, rule.error.flatten().fieldErrors);

  const scope = scopeSchema.safeParse({ scope: raw.scope, ratePlanIds: raw.ratePlanIds });
  if (!scope.success) {
    errors.ratePlanIds = scope.error.issues.map((i) =>
      i.path[0] === "scope" ? "Choose which rate plans the rule applies to." : i.message,
    );
  }

  if (!rule.success || !scope.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...rule.data,
      appliesToAll: scope.data.scope === "all",
      ratePlanIds: scope.data.scope === "some" ? [...new Set(scope.data.ratePlanIds)] : [],
    },
  };
}
