import { expect } from "bun:test";
import { expandNights } from "./metrics";
import { addDays, comparisonRange, enumerateDates, granularityFor, type CompareMode } from "./period";
import type { BookingFact, DeriveContext, Facts, InventoryFact, IsoDate, Widget } from "./types";

let counter = 0;

/** A two-night completed booking at €100 a night, created 1 September 2026. */
export function booking(over: Partial<BookingFact> = {}): BookingFact {
  counter += 1;
  const nights = over.nights ?? 2;
  const nightlyNetCents = over.nightlyNetCents ?? Array.from({ length: nights }, () => 10_000);
  const net = nightlyNetCents.reduce((total, cents) => total + cents, 0);
  const checkIn = over.checkIn ?? "2026-09-10";
  const discountCents = over.discountCents ?? 0;
  return {
    id: `bk-${counter}`,
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "completed",
    cancelledAt: null,
    adults: 2,
    children: 0,
    guestKey: `guest-${counter}`,
    guestCountry: "NL",
    roomId: "standard",
    ratePlanId: "flex",
    cancellationFeeCents: 0,
    ...over,
    checkIn,
    checkOut: over.checkOut ?? addDays(checkIn, nights),
    nights,
    nightlyNetCents,
    netRevenueCents: over.netRevenueCents ?? net,
    basePriceCents: over.basePriceCents ?? net + discountCents,
    discountCents,
  };
}

/** Ten standard rooms a night unless told otherwise. */
export function inventory(
  from: IsoDate,
  to: IsoDate,
  rooms: Record<string, number> = { standard: 10 },
  outOfOrder = 0,
): InventoryFact[] {
  return enumerateDates(from, to).flatMap((date) =>
    Object.entries(rooms).map(([roomId, unitsTotal]) => ({
      date, roomId, unitsTotal, unitsOutOfOrder: outOfOrder,
    })),
  );
}

export function facts(
  bookings: BookingFact[],
  inv: InventoryFact[] = inventory("2026-01-01", "2026-12-31"),
): Facts {
  return {
    bookings,
    inventory: inv,
    nights: expandNights(bookings),
    roomTypeNames: { standard: "Standard Double", suite: "Junior Suite" },
    ratePlanNames: { flex: "Flexible", saver: "Saver" },
  };
}

export function ctx(
  f: Facts,
  opts: { from: IsoDate; to: IsoDate; compare?: CompareMode; today?: IsoDate },
): DeriveContext {
  const period = { preset: "custom" as const, from: opts.from, to: opts.to };
  return {
    facts: f,
    period,
    comparison: comparisonRange(period, opts.compare ?? "previous"),
    today: opts.today ?? opts.to,
    granularity: granularityFor(period),
  };
}

/** Asserts the widget rendered and hands back its value. */
export function ok<T>(w: Widget<T>): T {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
}
