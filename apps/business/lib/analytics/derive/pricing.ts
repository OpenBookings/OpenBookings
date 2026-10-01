import { WEEKDAY_NAMES } from "../format";
import {
  adrCents, bookingsCreatedIn, inventoryIn, keptBookings, MIN_SAMPLE, nightsIn, occupancyPct,
  pct, ratio, revenueCents, stayRevenueCents, sum,
} from "../metrics";
import { weekdayOf } from "../period";
import type { BookingFact, DeriveContext, PricingView, RatePlanRow, SoldNight } from "../types";
import { overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

/** Above this occupancy, a weekday priced below average is leaving money on the table. */
export const HINT_OCCUPANCY_PCT = 85;

const discountedOnly = (rows: BookingFact[]) => rows.filter((b) => b.discountCents > 0);
const discountsGiven = (rows: BookingFact[]) => sum(rows, (b) => b.discountCents);

/** Discount as a share of the rack rate, among the bookings that got one. */
function discountDepth(rows: BookingFact[]): number | null {
  const discounted = discountedOnly(rows);
  return pct(discountsGiven(discounted), sum(discounted, (b) => b.basePriceCents));
}

const bucketAdr = (rows: SoldNight[]): number | null => ratio(stayRevenueCents(rows), rows.length);

export function derivePricing(ctx: DeriveContext): PricingView {
  const { facts, period, comparison, today, granularity } = ctx;

  // Stay-date basis: the ADR stat, its trend and the weekday table.
  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const periodAdr = adrCents(nights);

  // Booking-date basis: discounts and the rate plan table.
  const kept = keptBookings(bookingsCreatedIn(facts.bookings, period));
  const prevKept = comparison ? keptBookings(bookingsCreatedIn(facts.bookings, comparison)) : null;

  return {
    adr: widget("stay", nights.length, () => ({
      value: periodAdr,
      delta: makeDelta(periodAdr, prevNights ? adrCents(prevNights) : null),
    })),
    discounts: widget("booking", kept.length, () => ({
      value: discountsGiven(kept),
      shareOfBookingsPct: pct(discountedOnly(kept).length, kept.length),
      delta: makeDelta(discountsGiven(kept), prevKept ? discountsGiven(prevKept) : null, "neutral"),
    })),
    discountDepth: widget("booking", kept.length, () => ({
      value: discountDepth(kept),
      delta: makeDelta(discountDepth(kept), prevKept ? discountDepth(prevKept) : null, "neutral"),
    })),
    adrOverTime: widget("stay", nights.length, () =>
      overlay(
        toSeries(nights, (n) => n.date, period, granularity, today, bucketAdr),
        prevNights && comparison
          ? toSeries(prevNights, (n) => n.date, comparison, granularity, today, bucketAdr)
          : null,
      ),
    ),
    byRatePlan: widget(
      "booking",
      kept.length,
      () => {
        const plans = new Map<string, BookingFact[]>();
        for (const b of kept) {
          const rows = plans.get(b.ratePlanId);
          if (rows) rows.push(b);
          else plans.set(b.ratePlanId, [b]);
        }
        return [...plans.entries()]
          .map(([key, rows]): RatePlanRow => {
            const planNights = sum(rows, (b) => b.nights);
            return {
              key,
              label: facts.ratePlanNames[key] ?? key,
              bookings: rows.length,
              nights: planNights,
              adrCents: ratio(revenueCents(rows), planNights),
              revenueCents: revenueCents(rows),
            };
          })
          .sort((a, b) => b.revenueCents - a.revenueCents || a.label.localeCompare(b.label));
      },
    ),
    byWeekday: widget(
      "stay",
      nights.length,
      () =>
        WEEKDAY_NAMES.map((label, index) => {
          const weekday = index + 1;
          const dayNights = nights.filter((n) => weekdayOf(n.date) === weekday);
          const occupancy = occupancyPct(dayNights, inv.filter((i) => weekdayOf(i.date) === weekday));
          const adr = adrCents(dayNights);
          return {
            weekday,
            label,
            occupancyPct: occupancy,
            adrCents: adr,
            hint:
              occupancy !== null && occupancy > HINT_OCCUPANCY_PCT &&
              adr !== null && periodAdr !== null && adr < periodAdr,
          };
        }),
      MIN_SAMPLE,
    ),
  };
}
