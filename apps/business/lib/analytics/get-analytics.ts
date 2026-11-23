import { generateDemoFacts } from "./demo/generate";
import { deriveBookingPatterns } from "./derive/booking-patterns";
import { deriveGuests } from "./derive/guests";
import { deriveOccupancy } from "./derive/occupancy";
import { derivePricing } from "./derive/pricing";
import { deriveRevenue } from "./derive/revenue";
import { guestWindow } from "./guest-details";
import { bookingDate, earliestFactDate, inRange } from "./metrics";
import type { PageId } from "./pages";
import {
  addDays,
  comparisonRange,
  granularityFor,
  shiftYears,
  type CompareMode,
  type DateRange,
  type Period,
} from "./period";
import type { DeriveContext, Facts, IsoDate, PageData, PageViews } from "./types";

/** Everything a page asks for. There is no way to name a property. */
export interface PageQuery {
  period: Period;
  compare: CompareMode;
  today: IsoDate;
  /** Opt-in. Never inferred from the absence of real data. */
  demo: boolean;
}

const EMPTY_FACTS: Facts = {
  bookings: [], inventory: [], nights: [], roomTypeNames: {}, ratePlanNames: {},
};

const DERIVE: { [P in PageId]: (ctx: DeriveContext) => PageViews[P] } = {
  revenue: deriveRevenue,
  occupancy: deriveOccupancy,
  "booking-patterns": deriveBookingPatterns,
  pricing: derivePricing,
  guests: deriveGuests,
};

/** Only the literal `1`. `demo=true` is a typo, not a request for invented revenue. */
export function isDemoParam(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

/** Where real facts come from, for one hotel, over a window. */
export interface FactsSource {
  (page: PageId, window: DateRange, today: IsoDate): Promise<{
    facts: Facts;
    /** The hotel's earliest fact over its whole history, not just the window. */
    earliest: IsoDate | null;
    hasAnyBookings: boolean;
    guestWindowStart: IsoDate | null;
  }>;
}

/** Everything a page can show: period, its comparisons, 90 days ahead, and the guest window on guests. */
export function factsWindow(page: PageId, query: PageQuery): DateRange {
  const { period, today } = query;
  const ranges: DateRange[] = [
    period,
    comparisonRange(period, "previous"),
    query.compare === "last-year" ? comparisonRange(period, "last-year") : null,
    { from: today, to: addDays(today, 90) },
    page === "guests" ? guestWindow(today) : null,
  ].filter((r): r is DateRange => r !== null);
  return {
    from: ranges.reduce((min, r) => (r.from < min ? r.from : min), ranges[0].from),
    to: ranges.reduce((max, r) => (r.to > max ? r.to : max), ranges[0].to),
  };
}

/** The single entry point. Demo ignores the source; with no source there are no facts. */
export async function getPageData<P extends PageId>(
  page: P,
  query: PageQuery,
  source?: FactsSource,
): Promise<PageData<P>> {
  const { period, today, demo } = query;
  let facts: Facts;
  let earliest: IsoDate | null;
  let hasAnyBookings: boolean;
  let guestWindowStart: IsoDate | null = null;
  if (demo) {
    facts = generateDemoFacts(today);
    earliest = earliestFactDate(facts);
    hasAnyBookings = facts.bookings.length > 0;
  } else if (source) {
    ({ facts, earliest, hasAnyBookings, guestWindowStart } = await source(page, factsWindow(page, query), today));
  } else {
    facts = EMPTY_FACTS;
    earliest = null;
    hasAnyBookings = false;
  }
  const canCompareLastYear = earliest !== null && earliest <= shiftYears(period.from, -1);
  const compare: CompareMode =
    query.compare === "last-year" && !canCompareLastYear ? "previous" : query.compare;

  // A comparison range that ends before any fact exists compares against nothing.
  const candidate = comparisonRange(period, compare);
  const comparison = candidate && earliest !== null && candidate.to >= earliest ? candidate : null;

  const granularity = granularityFor(period);

  return {
    page,
    isDemo: demo,
    hasAnyBookings,
    // Either basis counts: a stay in the period still fills the stay-date widgets.
    periodHasBookings: facts.bookings.some(
      (b) => inRange(bookingDate(b), period) || (b.checkIn <= period.to && b.checkOut > period.from),
    ),
    range: { from: period.from, to: period.to },
    comparison,
    compare,
    canCompareLastYear,
    granularity,
    view: DERIVE[page]({ facts, period, comparison, today, granularity, guestWindowStart }),
  };
}
