import {
  calculateTouristTax,
  nonRefundableQualifies,
  snapshotTier,
  type PropertyCancellationTier,
  type TouristTaxRule,
} from "@openbookings/pricing";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import type { TonightPrice } from "@/lib/booking/quote";

/**
 * The listing page shows a price per night before the guest has picked dates
 * or guests. It is still the all-in price: one night from today at the
 * property, at the room's base occupancy, as the stay quote prices it
 * (`priceTonight`: overrides, modifiers and tourist tax). A rate that can't
 * be booked tonight (sold out, closed, a minimum stay…), or wasn't priced,
 * shows its base rate with the tourist tax in force today instead, marked
 * `price_from`: the page says "from". Search and checkout price the real
 * stay exactly.
 *
 * Worked out at render time rather than cached with the page data, so a
 * tourist tax rule or override that starts tomorrow applies from tomorrow.
 */
export function withAllInPrices(
  rooms: DbRoom[],
  rules: TouristTaxRule[],
  today: string,
  tonight: Record<string, TonightPrice> = {},
): DbRoom[] {
  return rooms.map((room) => ({
    ...room,
    rate_plans: room.rate_plans.map((plan) => {
      const t = tonight[plan.id];
      if (t?.sellable) return { ...plan, price_per_night_cents: t.priceCents };
      const tax = calculateTouristTax(rules, {
        nights: [{ date: today, priceCents: plan.bar_cents }],
        adults: Math.max(1, room.base_occupancy ?? 1),
        children: 0,
        rooms: 1,
      });
      return { ...plan, price_per_night_cents: plan.bar_cents + tax.totalCents, price_from: true };
    }),
  }));
}

/**
 * Each rate's cancellation tier, and Annex B B.4 applied to what the guest
 * sees: a Non-refundable rate is shown only beside a refundable rate on the
 * same room that costs at least 10% more, and says how much it saves. The
 * host's editor enforces this on the base rate when it is saved; this catches
 * a rate that drifted out of line afterwards.
 *
 * Whether a Non-refundable rate is shown is judged on base rates, as the
 * editor does; the saving is on the prices shown. With dates, the stay quote
 * judges both on the stay's own prices.
 */
export function withCancellationTerms(rooms: DbRoom[], tier: PropertyCancellationTier): DbRoom[] {
  return rooms.map((room) => {
    const refundable = room.rate_plans.filter((p) => p.is_refundable);
    const refundableBars = refundable.map((p) => p.bar_cents);
    const cheapestRefundable = refundable.reduce<number | null>(
      (min, p) =>
        min === null ? (p.price_per_night_cents ?? p.bar_cents) : Math.min(min, p.price_per_night_cents ?? p.bar_cents),
      null,
    );
    return {
      ...room,
      rate_plans: room.rate_plans
        .filter((p) => p.is_refundable || nonRefundableQualifies(p.bar_cents, refundableBars))
        .map((p) => ({
          ...p,
          cancellation_tier: snapshotTier(tier, p.is_refundable),
          ...(!p.is_refundable && cheapestRefundable !== null
            ? { saving_vs_refundable_cents: cheapestRefundable - (p.price_per_night_cents ?? p.bar_cents) }
            : {}),
        })),
    };
  });
}
