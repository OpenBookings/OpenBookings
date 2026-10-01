import { generateDemoFacts } from "./demo/generate";
import { deriveBookingPatterns } from "./derive/booking-patterns";
import { deriveGuests } from "./derive/guests";
import { deriveOccupancy } from "./derive/occupancy";
import { derivePricing } from "./derive/pricing";
import { deriveRevenue } from "./derive/revenue";
import { earliestFactDate } from "./metrics";
import type { PageId } from "./pages";
import { comparisonRange, granularityFor, shiftYears, type CompareMode, type Period } from "./period";
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

/**
 * The single entry point. When real queries land, the one line that picks the
 * facts changes; the returned type, every derivation and every component stay.
 */
export async function getPageData<P extends PageId>(page: P, query: PageQuery): Promise<PageData<P>> {
  const { period, today, demo } = query;
  const facts = demo ? generateDemoFacts(today) : EMPTY_FACTS;

  const earliest = earliestFactDate(facts);
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
    hasAnyBookings: facts.bookings.length > 0,
    range: { from: period.from, to: period.to },
    comparison,
    compare,
    canCompareLastYear,
    granularity,
    view: DERIVE[page]({ facts, period, comparison, today, granularity }),
  };
}
