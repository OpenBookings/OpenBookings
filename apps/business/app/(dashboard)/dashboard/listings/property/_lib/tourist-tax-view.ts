import { calculateTouristTax, type TouristTaxResult, type TouristTaxRule } from "@openbookings/pricing";
import { bookingSplitCents } from "@openbookings/stripe/fees";

/**
 * What the Tourist tax section shows, worked out without React so it can be
 * tested. The example calculator runs the same calculator checkout uses, and
 * the same commission maths Stripe is charged with, so the numbers a host
 * tries out here are the numbers a booking produces.
 */

/** "2026-12-30" + 3 → "2027-01-02". Dates are calendar days, so UTC throughout. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RuleGroups<R extends TouristTaxRule> {
  current: R | null;
  /** Soonest first. */
  upcoming: R[];
  /** Most recent first. */
  previous: R[];
}

export function groupRules<R extends TouristTaxRule>(rules: R[], today: string): RuleGroups<R> {
  const sorted = [...rules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const started = sorted.filter((r) => r.effectiveFrom <= today);
  return {
    current: started.at(-1) ?? null,
    upcoming: sorted.filter((r) => r.effectiveFrom > today),
    previous: started.slice(0, -1).reverse(),
  };
}

export interface ExampleInput {
  rules: TouristTaxRule[];
  commissionRate: number;
  arrival: string;
  nights: number;
  /** Per room per night in cents, incl. VAT, excl. tourist tax — what the host enters as a rate. */
  pricePerNightCents: number;
  adults: number;
  children: number;
  /** Under 2. Pay only where the rule says so. */
  infants?: number;
  rooms: number;
}

/** Every amount in cents. */
export interface ExampleResult {
  stayCents: number;
  touristTax: TouristTaxResult;
  guestTotalCents: number;
  commissionCents: number;
  hostReceivesCents: number;
}

const EMPTY: ExampleResult = {
  stayCents: 0,
  touristTax: { totalCents: 0, lines: [] },
  guestTotalCents: 0,
  commissionCents: 0,
  hostReceivesCents: 0,
};

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export function exampleStay(input: ExampleInput): ExampleResult {
  const nights = whole(input.nights);
  const rooms = Math.max(1, whole(input.rooms));
  const unitCents = input.pricePerNightCents;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.arrival) || nights === 0 || !Number.isSafeInteger(unitCents) || unitCents <= 0) {
    return EMPTY;
  }

  const nightCents = unitCents * rooms;
  const touristTax = calculateTouristTax(input.rules, {
    nights: Array.from({ length: nights }, (_, i) => ({ date: addDays(input.arrival, i), priceCents: nightCents })),
    adults: whole(input.adults),
    children: whole(input.children),
    infants: whole(input.infants ?? 0),
    rooms,
  });

  try {
    const split = bookingSplitCents({
      stayCents: nightCents * nights,
      touristTaxCents: touristTax.totalCents,
      rate: input.commissionRate,
    });
    return {
      stayCents: nightCents * nights,
      touristTax,
      guestTotalCents: split.guestTotalCents,
      commissionCents: split.commissionCents,
      hostReceivesCents: split.hostReceivesCents,
    };
  } catch {
    return EMPTY;
  }
}
