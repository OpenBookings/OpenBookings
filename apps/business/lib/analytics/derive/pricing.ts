import type { ModifierType } from "@openbookings/pricing";
import { granularityFor, type Period } from "../period";
import type { Category, Facts, PricingSection } from "../types";
import { toSeries } from "./buckets";
import { inRange, ratio } from "./totals";
import { widget } from "./widget";

/** Written once, so a modifier is named the same in the chart, the list and the CSV. */
export const MODIFIER_LABELS: Record<ModifierType, string> = {
  day_of_week: "Day-of-week rate",
  length_of_stay: "Length-of-stay discount",
  early_bird: "Early-bird discount",
  last_minute: "Last-minute discount",
  extra_guest: "Extra-guest charge",
};

const TOP_N = 10;

export function derivePricing(facts: Facts, period: Period): PricingSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);

  // Only nights that were actually priced. A night with no base price is not a
  // night sold at no discount — it is a night with no rate to discount from,
  // and averaging it in as zero drags the figure towards nothing.
  const priced = current.filter((n) => n.basePriceCents > 0);
  const baseCents = priced.reduce((sum, n) => sum + n.basePriceCents, 0);
  const achievedCents = priced.reduce((sum, n) => sum + n.netRevenueCents, 0);

  return {
    // Weighted by the money at stake rather than by night. One cheap night in a
    // quiet week must not outweigh a full week at rack rate. A surcharge comes
    // through as a negative discount rather than being dropped, so the two
    // lines below always have something to explain them.
    //
    // Algebraically `(1 − achieved ÷ base) × 100`, but with the whole numerator
    // kept in integer cents and one division at the end: the direct form makes
    // €9,000 against €10,000 read as 9.999999999999998%, which rounds fine and
    // compares catastrophically.
    averageDiscountPct: widget(() => ratio((baseCents - achievedCents) * 100, baseCents)),
    priceOverTime: widget(() => {
      const perNight = (pick: (n: (typeof current)[number]) => number) =>
        toSeries(
          current.filter((n) => n.unitsSold > 0),
          {
            date: (n) => n.date,
            // Per unit, so the line is a price rather than a nightly total.
            value: (n) => ratio(pick(n), n.unitsSold) ?? 0,
            from: period.from,
            to: period.to,
            granularity,
            reduce: "mean",
          },
        );
      return {
        base: perNight((n) => n.basePriceCents),
        achieved: perNight((n) => n.netRevenueCents),
      };
    }),
    topModifiers: widget<Category[]>(() => {
      const totals = new Map<ModifierType, { impactCents: number; count: number }>();
      for (const night of current) {
        for (const modifier of night.modifiers) {
          const entry = totals.get(modifier.type) ?? { impactCents: 0, count: 0 };
          entry.impactCents += modifier.impactCents;
          entry.count += 1;
          totals.set(modifier.type, entry);
        }
      }
      return [...totals.entries()]
        .map(([type, { impactCents, count }]) => ({
          key: type,
          label: MODIFIER_LABELS[type] ?? type,
          value: impactCents,
          count,
        }))
        // By how much money moved, in either direction: a discount that gave
        // away €12,000 matters more than an uplift that earned €5,000, and
        // sorting signed would bury it at the bottom.
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label))
        .slice(0, TOP_N);
    }),
  };
}
