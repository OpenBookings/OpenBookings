import {
  calculateTouristTax,
  nonRefundableQualifies,
  snapshotTier,
  type PropertyCancellationTier,
  type TouristTaxRule,
} from "@openbookings/pricing";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";

/**
 * The listing page shows a price per night before the guest has picked dates
 * or guests. It is still the all-in price: one night tonight, at the room's
 * standard occupancy, with the tourist tax in force today. Search and checkout
 * price the real stay exactly.
 *
 * Worked out at render time rather than cached with the page, so a tourist
 * tax rule that starts tomorrow applies from tomorrow, not an hour later.
 */
export function withAllInPrices(rooms: DbRoom[], rules: TouristTaxRule[], today: string): DbRoom[] {
  return rooms.map((room) => ({
    ...room,
    rate_plans: room.rate_plans.map((plan) => {
      const tax = calculateTouristTax(rules, {
        nights: [{ date: today, price: plan.bar }],
        adults: Math.max(1, room.base_occupancy ?? 1),
        children: 0,
        rooms: 1,
      });
      return { ...plan, price_per_night: Math.round((plan.bar + tax.total) * 100) / 100 };
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
 * The listing has no dates, so it compares base rates. Checkout prices the
 * actual stay.
 */
export function withCancellationTerms(rooms: DbRoom[], tier: PropertyCancellationTier): DbRoom[] {
  return rooms.map((room) => {
    const refundable = room.rate_plans.filter((p) => p.is_refundable);
    const refundableBars = refundable.map((p) => p.bar);
    const cheapestRefundable = refundable.reduce<number | null>(
      (min, p) => (min === null ? (p.price_per_night ?? p.bar) : Math.min(min, p.price_per_night ?? p.bar)),
      null,
    );
    return {
      ...room,
      rate_plans: room.rate_plans
        .filter((p) => p.is_refundable || nonRefundableQualifies(p.bar, refundableBars))
        .map((p) => ({
          ...p,
          cancellation_tier: snapshotTier(tier, p.is_refundable),
          ...(!p.is_refundable && cheapestRefundable !== null
            ? { saving_vs_refundable: Math.round((cheapestRefundable - (p.price_per_night ?? p.bar)) * 100) / 100 }
            : {}),
        })),
    };
  });
}
