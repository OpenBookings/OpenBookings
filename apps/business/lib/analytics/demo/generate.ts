import {
  resolveNightlyRates,
  type Night,
} from "@openbookings/pricing";
import { addDays, enumerateDates, weekdayOf } from "../period";
import type { BookingFact, Facts, IsoDate, NightFact } from "../types";
import { makeRng, type Rng } from "./rng";
import type { DemoProperty, DemoRatePlan } from "./properties";

/**
 * Demand shape. Two effects a host would recognise on their own numbers: the
 * weekend peak, and a summer high season that in the Netherlands runs June to
 * August with a shoulder either side.
 */
const WEEKEND_FACTOR: Record<number, number> = {
  1: 0.82, 2: 0.84, 3: 0.9, 4: 1.0, 5: 1.28, 6: 1.34, 7: 0.92,
};

const SEASON_FACTOR: Record<string, number> = {
  "01": 0.55, "02": 0.6, "03": 0.72, "04": 0.88, "05": 1.0, "06": 1.2,
  "07": 1.38, "08": 1.36, "09": 1.1, "10": 0.9, "11": 0.66, "12": 0.74,
};

/** Countries in the order they are drawn. The tail exists so the <5 fold fires. */
const COUNTRY_WEIGHTS: [string, number][] = [
  ["NL", 38], ["BE", 16], ["DE", 14], ["GB", 8], ["FR", 6], ["US", 4],
  ["IT", 3], ["ES", 3], ["DK", 2], ["SE", 2], ["PL", 1], ["IE", 1],
  ["JP", 1], ["CA", 1], ["AT", 1], ["PT", 1], ["NO", 1], ["CH", 1],
];

const CANCELLATION_RATE = 0.09;
/** Cents, from whole euros. The one place this conversion happens. */
const toCents = (euros: number): number => Math.round(euros * 100);

function pickCountry(rng: Rng): string {
  const total = COUNTRY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [code, weight] of COUNTRY_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return code;
  }
  return COUNTRY_WEIGHTS[0][0];
}

/** Share of inventory that sells on this date, before rounding to whole units. */
function demandFor(property: DemoProperty, date: IsoDate, rng: Rng): number {
  const weekend = WEEKEND_FACTOR[weekdayOf(date)] ?? 1;
  const season = SEASON_FACTOR[date.slice(5, 7)] ?? 1;
  const jitter = 0.82 + rng.next() * 0.36;
  return property.demand * weekend * season * jitter;
}

/**
 * Prices come out of the real calculator, not out of this file. A demo revenue
 * figure that did not pass through the modifier pipeline would agree with
 * nothing — not the ARI grid, not a guest quote — and section 4 would be
 * comparing a base price against a number nobody computed.
 */
function priceNights(plan: DemoRatePlan, dates: IsoDate[], today: IsoDate) {
  const nights: Night[] = dates.map((date) => ({
    date,
    base_price: plan.barEuros,
    has_override: false,
  }));
  return resolveNightlyRates(nights, plan.modifiers, { baseOccupancy: 2, today });
}

export function generateFacts(
  property: DemoProperty,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): Facts {
  const dates = enumerateDates(from, to);
  const nights: NightFact[] = [];

  for (const plan of property.ratePlans) {
    const roomType = property.roomTypes.find((r) => r.id === plan.roomId);
    if (!roomType) continue;

    // Seeded per plan, so adding a plan cannot shift another plan's history.
    const rng = makeRng(`${property.seed}:${plan.id}`);
    const rates = priceNights(plan, dates, today);

    dates.forEach((date, i) => {
      const rate = rates[i];
      // A few units are held back now and then: maintenance, owner use.
      const blocked = rng.bool(0.04) ? rng.int(1, Math.max(1, Math.floor(roomType.units / 3))) : 0;
      const unitsAvailable = Math.max(0, roomType.units - blocked);

      const open = property.openedOn !== null && date >= property.openedOn;
      const unitsSold = open
        ? Math.min(unitsAvailable, Math.max(0, Math.round(unitsAvailable * demandFor(property, date, rng))))
        : 0;

      // The trace carries one step per modifier that actually fired, with a
      // signed euro delta. Multiplying by unitsSold gives the revenue impact
      // for the night; a modifier that did not fire leaves no step and so
      // contributes nothing, which is the behaviour section 4 reports.
      const modifiers = rate.trace
        .filter((step) => step.modifier_type !== undefined)
        .map((step) => ({
          type: step.modifier_type!,
          impactCents: toCents(step.delta * unitsSold),
        }));

      nights.push({
        date,
        propertyId: property.id,
        roomId: roomType.id,
        ratePlanId: plan.id,
        unitsAvailable,
        unitsSold,
        netRevenueCents: toCents(rate.price * unitsSold),
        basePriceCents: toCents(plan.barEuros * unitsSold),
        modifiers,
      });
    });
  }

  nights.sort((a, b) => a.date.localeCompare(b.date) || a.ratePlanId.localeCompare(b.ratePlanId));

  return {
    nights,
    bookings: generateBookings(property, nights, today),
    roomTypeNames: Object.fromEntries(property.roomTypes.map((r) => [r.id, r.name])),
    ratePlanNames: Object.fromEntries(property.ratePlans.map((p) => [p.id, p.name])),
  };
}

/**
 * Bookings are assembled from the nights that sold rather than invented beside
 * them, so the two arrays describe the same trading. A booking is a run of
 * consecutive sold nights on one plan; its revenue is the sum of those nights'
 * per-unit revenue.
 */
function generateBookings(
  property: DemoProperty,
  nights: NightFact[],
  today: IsoDate,
): BookingFact[] {
  if (property.openedOn === null) return [];

  const rng = makeRng(`${property.seed}:bookings`);
  const bookings: BookingFact[] = [];
  // A small pool, so some guests recur and "repeat guests" is not always zero.
  const guestPool = Array.from({ length: 140 }, (_, i) => `guest-${property.id}-${i}`);

  const byPlan = new Map<string, NightFact[]>();
  for (const night of nights) {
    if (night.unitsSold === 0) continue;
    const list = byPlan.get(night.ratePlanId) ?? [];
    list.push(night);
    byPlan.set(night.ratePlanId, list);
  }

  for (const [planId, planNights] of byPlan) {
    let cursor = 0;
    while (cursor < planNights.length) {
      const stay = rng.int(1, 5);
      const window = planNights.slice(cursor, cursor + stay);
      cursor += window.length;
      if (window.length === 0) break;

      const checkIn = window[0].date;
      const checkOut = addDays(window[window.length - 1].date, 1);
      const leadDays = rng.int(0, 120);
      const createdAt = `${addDays(checkIn, -leadDays)}T${String(rng.int(8, 21)).padStart(2, "0")}:00:00.000Z`;
      const cancelled = rng.bool(CANCELLATION_RATE);

      // Per-unit revenue: the night's revenue divided by the units that sold.
      const netRevenueCents = window.reduce(
        (sum, n) => sum + Math.round(n.netRevenueCents / Math.max(1, n.unitsSold)),
        0,
      );

      bookings.push({
        id: `bk-${property.id}-${planId}-${checkIn}`,
        propertyId: property.id,
        createdAt,
        checkIn,
        checkOut,
        nights: window.length,
        status: cancelled ? "cancelled" : checkOut <= today ? "completed" : "confirmed",
        cancelledAt: cancelled ? `${addDays(checkIn, -rng.int(1, Math.max(1, leadDays)))}T12:00:00.000Z` : null,
        adults: rng.int(1, 2),
        children: rng.bool(0.22) ? rng.int(1, 2) : 0,
        guestKey: rng.pick(guestPool),
        guestCountry: pickCountry(rng),
        netRevenueCents,
        roomId: window[0].roomId,
        ratePlanId: planId,
      });
    }
  }

  return bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
