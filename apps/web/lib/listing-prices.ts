import { calculateTouristTax, type TouristTaxRule } from "@openbookings/pricing";
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
