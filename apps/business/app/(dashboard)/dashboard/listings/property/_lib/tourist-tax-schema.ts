import { formatCents, parseEuroInput } from "@openbookings/pricing/money";
import { z } from "zod";
import type { TouristTaxCharge, TouristTaxRule } from "@openbookings/pricing";

/**
 * What a host may save as a tourist tax rule. It comes out as the calculator's
 * own TouristTaxRule, so what is validated here is exactly what is priced.
 * Amounts go in as the text the host typed and are read here, on the server.
 *
 * Whether the start date is in the future is checked by the action, not here:
 * "today" depends on the property's time zone, which a schema cannot see.
 */

export const MAX_CHARGES = 8;

/**
 * Upper bounds per charge. The highest EU tourist taxes are around 12.5% of
 * the room price (Amsterdam) and around €16 per person per night (Paris
 * palaces). Commission is taken on the room price only, so an unbounded tax
 * would let a host move booking value out of the commission base.
 */
export const MAX_TAX_PERCENT = 25;
/** €25, in cents. */
export const MAX_TAX_FIXED_CENTS = 2500;

/** A percentage as typed: "6.5" or "6,5", at most two decimals; otherwise why not. */
function readPercent(text: string): { ok: true; percent: number } | { ok: false; error: string } {
  const t = text.trim();
  if (/^\d+[.,]\d{3,}$/.test(t)) return { ok: false, error: "Use at most two decimals" };
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(t)) return { ok: false, error: "Enter a percentage like 6.5" };
  return { ok: true, percent: Number(t.replace(",", ".")) };
}

/**
 * One charge as the dialog sends it: the amount is the text the host typed.
 * A fixed amount is read into cents ("2,50" → 250), a percentage stays a
 * percentage. Out comes the calculator's own TouristTaxCharge.
 */
export const touristTaxChargeSchema = z
  .object({
    kind: z.enum(["percent", "fixed"]),
    amount: z.string({ error: "Enter an amount." }),
    perPerson: z.boolean(),
    perNight: z.boolean(),
    perRoom: z.boolean(),
    vatIncludedPercent: z
      .number()
      .min(0, "VAT cannot be negative.")
      .max(50, "VAT cannot be more than 50%.")
      .nullish(),
  })
  .transform((c, ctx): TouristTaxCharge => {
    const issue = (message: string) => {
      ctx.addIssue({ code: "custom", path: ["amount"], message });
      return z.NEVER;
    };
    const flags = { perPerson: c.perPerson, perNight: c.perNight, perRoom: c.perRoom };
    // The calculator ignores the settings that do not belong to a kind;
    // clearing them here keeps what is stored honest about what is charged.
    if (c.kind === "percent") {
      const read = readPercent(c.amount);
      if (!read.ok) return issue(read.error);
      if (read.percent <= 0) return issue("Enter an amount above zero.");
      if (read.percent > MAX_TAX_PERCENT) {
        return issue(`A tourist tax percentage cannot be more than ${MAX_TAX_PERCENT}%.`);
      }
      return {
        kind: "percent",
        percent: read.percent,
        perPerson: false,
        perNight: false,
        perRoom: false,
        vatIncludedPercent: c.vatIncludedPercent || null,
      };
    }
    const read = parseEuroInput(c.amount);
    if (!read.ok) return issue(read.error);
    if (read.cents <= 0) return issue("Enter an amount above zero.");
    if (read.cents > MAX_TAX_FIXED_CENTS) {
      return issue(`A tourist tax amount cannot be more than ${formatCents(MAX_TAX_FIXED_CENTS)}.`);
    }
    return { kind: "fixed", amountCents: read.cents, ...flags, vatIncludedPercent: null };
  });

/** A charge as the dialog holds it before saving. */
export type TouristTaxChargeInput = z.input<typeof touristTaxChargeSchema>;

export const touristTaxRuleSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date this rule starts."),
  charges: z.array(touristTaxChargeSchema).max(MAX_CHARGES, `A rule can have at most ${MAX_CHARGES} charges.`),
  childrenExempt: z.boolean(),
  /** Off unless the host turns it on: most towns don't tax infants. */
  infantsTaxed: z.boolean().default(false),
  maxNights: z
    .number()
    .int("Enter at least 1 night, or leave it empty.")
    .min(1, "Enter at least 1 night, or leave it empty.")
    .max(365, "Enter at most 365 nights.")
    .nullable(),
}) satisfies z.ZodType<TouristTaxRule, unknown>;
