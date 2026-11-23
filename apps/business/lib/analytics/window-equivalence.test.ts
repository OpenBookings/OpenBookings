/**
 * The oracle for the load window: every page must show exactly the same thing
 * whether it is given the hotel's whole history or only the facts the live
 * loader would return for `factsWindow(page, query)`. A derivation that reads
 * outside the window (year to date, pace, …) fails here, on demo facts.
 */
import { describe, expect, test } from "bun:test";
import { buildDemoFacts } from "./demo/generate";
import { factsWindow, getPageData, type FactsSource, type PageQuery } from "./get-analytics";
import { guestWindow } from "./guest-details";
import { bookingDate, earliestFactDate } from "./metrics";
import { PAGE_IDS } from "./pages";
import { addDays, COMPARE_MODES, resolvePeriod, type DateRange, type Period } from "./period";
import type { Facts, IsoDate } from "./types";

/** Guest details exist only for bookings made in the guest window, as the live loader attaches them. */
function withGuestWindow(facts: Facts, today: IsoDate): Facts {
  const window = guestWindow(today);
  return {
    ...facts,
    bookings: facts.bookings.map((b) => {
      const date = bookingDate(b);
      return date >= window.from && date <= window.to
        ? b
        : { ...b, guestKey: "", guestCountry: "", adults: 0, children: 0, hasGuestDetails: false };
    }),
  };
}

/**
 * The live loader's window rule: a booking is in when it was made in the
 * window (its Amsterdam booking date) or has a night in it; nights and
 * inventory are clipped to the window.
 */
function clipToWindow(facts: Facts, window: DateRange): Facts {
  const inWindow = (d: IsoDate) => d >= window.from && d <= window.to;
  return {
    ...facts,
    bookings: facts.bookings.filter(
      (b) => inWindow(bookingDate(b)) || (b.checkIn <= window.to && b.checkOut > window.from),
    ),
    nights: facts.nights.filter((n) => inWindow(n.date)),
    inventory: facts.inventory.filter((i) => inWindow(i.date)),
  };
}

function source(all: Facts, clip: boolean): FactsSource {
  const earliest = earliestFactDate(all);
  return async (page, window, today) => ({
    facts: clip ? clipToWindow(all, window) : all,
    earliest,
    hasAnyBookings: all.bookings.length > 0,
    guestWindowStart: page === "guests" ? guestWindow(today).from : null,
  });
}

function periods(today: IsoDate): Period[] {
  return [
    resolvePeriod("last-7-days", today),
    resolvePeriod("last-30-days", today),
    resolvePeriod("last-3-months", today),
    resolvePeriod("last-12-months", today),
    resolvePeriod("ytd", today),
    // Five years, the longest a custom range can be.
    resolvePeriod("custom", today, { from: addDays(today, -366 * 5 + 1), to: today }),
    // A month well in the past, and one ahead.
    resolvePeriod("custom", today, { from: addDays(today, -500), to: addDays(today, -470) }),
    resolvePeriod("custom", today, { from: addDays(today, 10), to: addDays(today, 40) }),
  ];
}

describe("the load window holds everything a page reads", () => {
  for (const today of ["2026-10-01", "2026-02-15"]) {
    const all = withGuestWindow(buildDemoFacts(today), today);
    const full = source(all, false);
    const windowed = source(all, true);

    for (const page of PAGE_IDS) {
      test(`${page}, today ${today}`, async () => {
        for (const period of periods(today)) {
          for (const compare of COMPARE_MODES) {
            const query: PageQuery = { period, compare, today, demo: false };
            const expected = await getPageData(page, query, full);
            const actual = await getPageData(page, query, windowed);
            const where = `${period.preset} ${period.from}..${period.to}, compare ${compare}, window ${JSON.stringify(factsWindow(page, query))}`;
            expect({ where, data: actual }).toEqual({ where, data: expected });
          }
        }
      });
    }
  }
});
