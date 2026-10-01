import { addDays, daysBetween, type DateRange } from "./period";
import type {
  BookingFact, Facts, GroupType, InventoryFact, IsoDate, Share, SoldNight,
} from "./types";

/** OpenBookings' cut of net room revenue. */
export const COMMISSION_RATE = 0.045;
/** Distributions, rankings and tables refuse to render below this. */
export const MIN_SAMPLE = 5;
export const TOP_N = 5;
export const OTHER_KEY = "OTHER";

/**
 * The only divisions in analytics. A host reading "€NaN" learns nothing; a host
 * reading "—" learns the question had no answer this period.
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function pct(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : r * 100;
}

export function sum<T>(rows: T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const bookingDate = (b: BookingFact): IsoDate => b.createdAt.slice(0, 10);
export const isCancelled = (b: BookingFact): boolean => b.status === "cancelled";
export const inRange = (date: IsoDate, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

/** Booking-date basis: every booking made in the range, cancelled or not. */
export const bookingsCreatedIn = (bookings: BookingFact[], range: DateRange): BookingFact[] =>
  bookings.filter((b) => inRange(bookingDate(b), range));

export const keptBookings = (bookings: BookingFact[]): BookingFact[] =>
  bookings.filter((b) => !isCancelled(b));

/** Stay-date basis. */
export const nightsIn = (nights: SoldNight[], range: DateRange): SoldNight[] =>
  nights.filter((n) => inRange(n.date, range));

export const inventoryIn = (inventory: InventoryFact[], range: DateRange): InventoryFact[] =>
  inventory.filter((i) => inRange(i.date, range));

/** Net room revenue of bookings that were not cancelled. */
export const revenueCents = (kept: BookingFact[]): number => sum(kept, (b) => b.netRevenueCents);
export const stayRevenueCents = (nights: SoldNight[]): number => sum(nights, (n) => n.revenueCents);

/** Total units minus out-of-order units. Dates closed for sale still count. */
export const nightsAvailable = (inventory: InventoryFact[]): number =>
  sum(inventory, (i) => Math.max(0, i.unitsTotal - i.unitsOutOfOrder));

export const occupancyPct = (nights: SoldNight[], inventory: InventoryFact[]): number | null =>
  pct(nights.length, nightsAvailable(inventory));

export const adrCents = (nights: SoldNight[]): number | null =>
  ratio(stayRevenueCents(nights), nights.length);

export const revparCents = (nights: SoldNight[], inventory: InventoryFact[]): number | null =>
  ratio(stayRevenueCents(nights), nightsAvailable(inventory));

/** Rounded once, on the total. Per-booking rounding drifts by a cent a booking. */
export const commissionCents = (revenue: number): number => Math.round(revenue * COMMISSION_RATE);

/** A booking made after check-in is same-day, not negative days out. */
export const leadDays = (b: BookingFact): number =>
  Math.max(0, daysBetween(bookingDate(b), b.checkIn) - 1);

export function groupTypeOf(b: BookingFact): GroupType {
  if (b.children > 0) return "family";
  if (b.adults === 1) return "solo";
  if (b.adults === 2) return "couple";
  return "group";
}

/**
 * Night facts come from bookings and from nowhere else, so nights sold and
 * bookings cannot disagree.
 */
export function expandNights(bookings: BookingFact[]): SoldNight[] {
  return keptBookings(bookings).flatMap((b) =>
    b.nightlyNetCents.map((revenueCents, index) => ({
      date: addDays(b.checkIn, index),
      roomId: b.roomId,
      ratePlanId: b.ratePlanId,
      bookingId: b.id,
      revenueCents,
    })),
  );
}

export function earliestFactDate(facts: Facts): IsoDate | null {
  let earliest: IsoDate | null = null;
  for (const b of facts.bookings) {
    const date = bookingDate(b);
    if (earliest === null || date < earliest) earliest = date;
  }
  return earliest;
}

export function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const groups = new Map<string, number>();
  for (const row of rows) groups.set(key(row), (groups.get(key(row)) ?? 0) + value(row));
  return groups;
}

/**
 * Ranked, with each row's share of the total. Beyond `top` rows the rest fold
 * into Other, which sits last whatever its size: it is a residual, not a rank.
 */
export function shares(
  groups: Map<string, number>,
  names: Record<string, string>,
  top: number = TOP_N,
): Share[] {
  const total = [...groups.values()].reduce((t, v) => t + v, 0);
  const ranked = [...groups.entries()]
    .map(([key, value]) => ({ key, label: names[key] ?? key, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const head = ranked.slice(0, top);
  const tail = ranked.slice(top);
  const rows = tail.length > 0
    ? [...head, { key: OTHER_KEY, label: "Other", value: tail.reduce((t, r) => t + r.value, 0) }]
    : head;
  return rows.map((row) => ({ ...row, sharePct: pct(row.value, total) ?? 0 }));
}
