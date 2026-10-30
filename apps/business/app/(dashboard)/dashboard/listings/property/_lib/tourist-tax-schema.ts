import { z } from "zod";
import type { TouristTaxCharge, TouristTaxRule } from "@openbookings/pricing";

/**
 * What a host may save as a tourist tax rule. The shape is the calculator's
 * own TouristTaxRule, so what is validated here is exactly what is priced.
 *
 * Whether the start date is in the future is checked by the action, not here:
 * "today" depends on the property's time zone, which a schema cannot see.
 */

export const MAX_CHARGES = 8;

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

const charge = z
  .object({
    kind: z.enum(["percent", "fixed"]),
    amount: z
      .number({ error: "Enter an amount." })
      .positive("Enter an amount above zero.")
      .refine(twoDecimals, "Use at most two decimals."),
    perPerson: z.boolean(),
    perNight: z.boolean(),
    perRoom: z.boolean(),
    vatIncludedPercent: z
      .number()
      .min(0, "VAT cannot be negative.")
      .max(50, "VAT cannot be more than 50%.")
      .nullish(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "percent" && c.amount > 100) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "A percentage cannot be more than 100." });
    }
    if (c.kind === "fixed" && c.amount > 1000) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "An amount cannot be more than €1,000." });
    }
  })
  // The calculator ignores the settings that do not belong to a kind; clearing
  // them here keeps what is stored honest about what is charged.
  .transform(
    (c): TouristTaxCharge =>
      c.kind === "percent"
        ? { ...c, perPerson: false, perNight: false, perRoom: false, vatIncludedPercent: c.vatIncludedPercent || null }
        : { ...c, vatIncludedPercent: null },
  );

export const touristTaxRuleSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date this rule starts."),
  charges: z.array(charge).max(MAX_CHARGES, `A rule can have at most ${MAX_CHARGES} charges.`),
  childrenExempt: z.boolean(),
  maxNights: z
    .number()
    .int("Enter at least 1 night, or leave it empty.")
    .min(1, "Enter at least 1 night, or leave it empty.")
    .max(365, "Enter at most 365 nights.")
    .nullable(),
}) satisfies z.ZodType<TouristTaxRule, unknown>;

export type TouristTaxRuleInput = z.input<typeof touristTaxRuleSchema>;
