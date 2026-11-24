import {
  calculateTouristTax,
  nonRefundableQualifies,
  snapshotTier,
  type PropertyCancellationTier,
  type TouristTaxRule,
} from "@openbookings/pricing";
import type { DbRatePlan, DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
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
 * A rate a connected app prices (SiteMinder) never shows our base rate: the
 * hotel no longer keeps it. If tonight can't be booked, it shows the app's
 * price for tonight as "from"; if the app sent no price for tonight, no price
 * at all (`price_per_night_cents: null`). Its `bar_cents` is removed so the
 * page never has it. Managed is what priceTonight says, or where it has no
 * answer (it failed) what the page data says, so a failed priceTonight
 * doesn't bring the base rate back.
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
    rate_plans: room.rate_plans.map((plan): DbRatePlan => {
      const t = tonight[plan.id];
      // priceTonight is live; the page data may be up to an hour old.
      const managed = t ? t.managed === true : plan.managed === true;
      if (managed) {
        // Our own base rate stays off the page.
        const rest: DbRatePlan = { ...plan };
        delete rest.bar_cents;
        if (t?.priceCents == null) return { ...rest, managed: true, price_per_night_cents: null };
        return { ...rest, managed: true, price_per_night_cents: t.priceCents, ...(t.sellable ? {} : { price_from: true }) };
      }
      if (t?.sellable && t.priceCents !== null) return { ...plan, price_per_night_cents: t.priceCents };
      const bar = plan.bar_cents ?? 0;
      const tax = calculateTouristTax(rules, {
        nights: [{ date: today, priceCents: bar }],
        adults: Math.max(1, room.base_occupancy ?? 1),
        children: 0,
        rooms: 1,
      });
      return { ...plan, price_per_night_cents: bar + tax.totalCents, price_from: true };
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
 *
 * A room whose rates a connected app prices has no base rate to judge (and
 * its prices change by the night, so tonight's would hide a rate for every
 * date: the page only offers rates it lists). Its Non-refundable rates are
 * kept as long as the room has a refundable rate; the 10% rule is left to the
 * stay quote, which applies it to the stay's own prices before anything can
 * be booked. The saving is shown only where both prices are tonight's.
 */
export function withCancellationTerms(rooms: DbRoom[], tier: PropertyCancellationTier): DbRoom[] {
  return rooms.map((room) => {
    const refundable = room.rate_plans.filter((p) => p.is_refundable);
    const managed = room.rate_plans.some((p) => p.managed);
    return {
      ...room,
      rate_plans: room.rate_plans
        .filter((p) => p.is_refundable || (managed ? refundable.length > 0 : qualifiesOnBase(p, refundable)))
        .map((p) => {
          const saving = p.is_refundable ? null : savingCents(p, refundable, managed);
          return {
            ...p,
            cancellation_tier: snapshotTier(tier, p.is_refundable),
            ...(saving !== null ? { saving_vs_refundable_cents: saving } : {}),
          };
        }),
    };
  });
}

/** B.4.2 on base rates, as the editor applies it. */
function qualifiesOnBase(plan: DbRatePlan, refundable: DbRatePlan[]): boolean {
  return nonRefundableQualifies(plan.bar_cents ?? 0, refundable.map((p) => p.bar_cents ?? 0));
}

/**
 * How much less a night costs than the cheapest refundable rate, on the prices
 * shown (falling back to base rates where none was worked out). On a managed
 * room only tonight's prices count: null when either side has none.
 */
function savingCents(plan: DbRatePlan, refundable: DbRatePlan[], managed: boolean): number | null {
  const shown = (p: DbRatePlan) => (managed ? p.price_per_night_cents ?? null : p.price_per_night_cents ?? p.bar_cents ?? null);
  const own = shown(plan);
  const theirs = refundable.map(shown).filter((c): c is number => c !== null);
  if (own === null || theirs.length === 0) return null;
  return Math.min(...theirs) - own;
}
