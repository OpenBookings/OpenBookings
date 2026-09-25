import type { Category, IsoDate, NightFact } from "../types";

/** OpenBookings' cut of net room revenue. */
export const COMMISSION_RATE = 0.045;

export function inRange(nights: NightFact[], from: IsoDate, to: IsoDate): NightFact[] {
  return nights.filter((n) => n.date >= from && n.date <= to);
}

export function sumRevenueCents(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.netRevenueCents, 0);
}

export function sumNightsSold(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.unitsSold, 0);
}

export function sumNightsAvailable(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
}

/**
 * The only division in this module. Nothing here may produce NaN or Infinity:
 * a host reading "€NaN" learns nothing, and a host reading "—" learns that the
 * question had no answer this period, which is true and useful.
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function rank(
  groups: Map<string, number>,
  names: Record<string, string>,
): Category[] {
  return [...groups.entries()]
    .map(([key, value]) => ({ key, label: names[key] ?? key, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const groups = new Map<string, number>();
  for (const row of rows) groups.set(key(row), (groups.get(key(row)) ?? 0) + value(row));
  return groups;
}
