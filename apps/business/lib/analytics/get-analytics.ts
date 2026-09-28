import { deriveBookings } from "./derive/bookings";
import { deriveGuests } from "./derive/guests";
import { derivePricing } from "./derive/pricing";
import { deriveRevenue } from "./derive/revenue";
import { deriveSellThrough } from "./derive/sell-through";
import { generateFacts } from "./demo/generate";
import { DEMO_PROPERTIES, findDemoProperty } from "./demo/properties";
import { addDays, comparisonRange, granularityFor, type Period } from "./period";
import type {
  AnalyticsData,
  Facts,
  IsoDate,
  PropertySummary,
  Widget,
} from "./types";

export interface AnalyticsQuery {
  propertyId?: string;
  period: Period;
  today: IsoDate;
  /** Opt-in. Never inferred from the absence of real data. */
  demo: boolean;
  /** Demo-only: forces one widget to fail, so the error state is reachable. */
  fail?: string;
}

/** Long enough for the skeletons to be visible, short enough not to annoy. */
export const DEMO_DELAY_MS = 350;

const EMPTY_FACTS: Facts = { nights: [], bookings: [], roomTypeNames: {}, ratePlanNames: {} };

export function listProperties(demo: boolean): PropertySummary[] {
  // Nothing to list until the real query lands: the property selector appears
  // only when there is more than one, and outside demo mode there are none.
  return demo ? DEMO_PROPERTIES.map(({ id, name }) => ({ id, name })) : [];
}

/**
 * The single entry point. Today it generates facts and derives; when the real
 * queries land, only this function's body changes — the returned type, every
 * derivation and every component stay exactly as they are.
 */
export async function getAnalytics(query: AnalyticsQuery): Promise<AnalyticsData> {
  const { period, today, demo } = query;

  if (demo) await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY_MS));

  const property = demo
    ? (({ id, name }) => ({ id, name }))(findDemoProperty(query.propertyId))
    : { id: query.propertyId ?? "unknown", name: "Your property" };

  const facts = demo
    ? generateFacts(findDemoProperty(query.propertyId), ...factWindow(period, today), today)
    : EMPTY_FACTS;

  const data: AnalyticsData = {
    property,
    properties: listProperties(demo),
    range: { from: period.from, to: period.to },
    granularity: granularityFor(period),
    // "Ever", not "in this period". An established host with a quiet fortnight
    // must not be told they are waiting for their first booking.
    hasAnyBookings: facts.bookings.length > 0,
    bookingsInPeriod: facts.bookings.filter(
      (b) => b.createdAt.slice(0, 10) >= period.from && b.createdAt.slice(0, 10) <= period.to,
    ).length,
    isDemo: demo,
    revenue: deriveRevenue(facts, period, today),
    sellThrough: deriveSellThrough(facts, period),
    bookings: deriveBookings(facts, period, today),
    pricing: derivePricing(facts, period),
    guests: deriveGuests(facts, period),
  };

  return demo && query.fail ? forceFailure(data, query.fail) : data;
}

/**
 * Facts have to cover more than the selected period: year to date reaches back
 * to 1 January and its delta a year before that, the ordinary delta reaches one
 * period back, repeat guests reach across all history, and the upcoming windows
 * reach ninety days forward. This is the one place that knows the union.
 */
function factWindow(period: Period, today: IsoDate): [IsoDate, IsoDate] {
  const comparison = comparisonRange(period);
  const lastYearStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const from = [period.from, comparison?.from ?? period.from, lastYearStart].sort()[0];
  const to = [period.to, addDays(today, 90)].sort().at(-1)!;
  return [from, to];
}

/**
 * Demo-only. Without it the error row of the spec's States table is unreachable,
 * which means it is also untested and nobody finds out it is broken.
 */
function forceFailure(data: AnalyticsData, path: string): AnalyticsData {
  const [section, key] = path.split(".");
  const target = (data as unknown as Record<string, Record<string, Widget<unknown>>>)[section];
  if (!target || !(key in target)) return data;
  target[key] = { ok: false, message: "We could not work this one out." };
  return data;
}
