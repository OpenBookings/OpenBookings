/**
 * Facts for a window, assembled from cached finished months plus a live tail.
 * Finished months are computed once and kept (see migration 0057 for what
 * empties them); the current month is always read live. The hotel id is an
 * argument taken from the session by the caller, never from the URL.
 *
 * A cached month is served only when its version, its month generation and the
 * hotel-wide generation all still match. A build reads both generations before
 * loading and the store refuses the write if either has moved since.
 */
import * as Sentry from "@sentry/nextjs";
import { loadNames, loadWindowFacts } from "./facts-query";
import { createMonthStore } from "./facts-cache-store";
import { bookingDate } from "./metrics";
import { endOfMonth, startOfMonth, type DateRange } from "./period";
import type { BookingFact, Facts, InventoryFact, IsoDate, SoldNight } from "./types";

/** Bump when the shape or meaning of stored facts changes: old rows are then rebuilt. */
/** 2: money in cents (0058). Months cached under 1 were built from euro columns. */
export const FACTS_CACHE_VERSION = 2;

/** Generations a build started from: the month's, and the hotel-wide sentinel's. */
export interface MonthGenerations {
  month: number;
  hotel: number;
}

export interface MonthStore {
  /** Only rows with the current version and both generations current. */
  read(propertyId: string, months: IsoDate[]): Promise<Map<IsoDate, Facts>>;
  /** Missing rows count as generation 0. */
  generations(propertyId: string, months: IsoDate[]): Promise<{ months: Map<IsoDate, number>; hotel: number }>;
  /** Upsert, unless either generation has moved on since it was read. */
  write(propertyId: string, month: IsoDate, gen: MonthGenerations, facts: Facts): Promise<void>;
}

interface Deps {
  store: MonthStore;
  loadLive: (propertyId: string, window: DateRange) => Promise<Facts>;
  /** Names are always read live: a rename fires no cache trigger. */
  loadNames: (propertyId: string) => Promise<{ roomTypeNames: Record<string, string>; ratePlanNames: Record<string, string> }>;
}

const BUILD_CONCURRENCY = 3;

/** Run `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Nothing guest-level, and no names, are ever stored, whatever the loader returns. */
function stripForStorage(facts: Facts): Facts {
  return {
    ...facts,
    roomTypeNames: {},
    ratePlanNames: {},
    bookings: facts.bookings.map((b) => ({
      ...b,
      guestKey: "",
      guestCountry: "",
      adults: 0,
      children: 0,
      hasGuestDetails: false,
    })),
  };
}

function monthsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = startOfMonth(from); m <= to; ) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  }
  return out;
}

/** Months grouped into runs of consecutive months, in order. */
function consecutiveRuns(months: IsoDate[]): IsoDate[][] {
  const runs: IsoDate[][] = [];
  for (const m of months) {
    const run = runs[runs.length - 1];
    if (run && monthsBetween(run[run.length - 1], m).length === 2) run.push(m);
    else runs.push([m]);
  }
  return runs;
}

/**
 * The live loader's window rule applied in memory: bookings made in the window
 * (Amsterdam booking date) or with a night in it; nights and capacity by date.
 * A month sliced from a longer load is exactly what loading that month gives.
 */
function sliceToWindow(facts: Facts, window: DateRange): Facts {
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

export async function assembleFacts(
  propertyId: string,
  window: DateRange,
  today: IsoDate,
  deps: Deps,
): Promise<Facts> {
  const currentMonth = startOfMonth(today);
  const all = monthsBetween(window.from, window.to);
  const finished = all.filter((m) => endOfMonth(m) < currentMonth);
  const live = all.filter((m) => !finished.includes(m));

  const cached = await deps.store.read(propertyId, finished);
  const missing = finished.filter((m) => !cached.has(m));
  const gens = missing.length > 0 ? await deps.store.generations(propertyId, missing) : null;

  const monthWindow = (m: IsoDate): DateRange => ({ from: m, to: endOfMonth(m) });

  // One ranged load per run of consecutive missing months, sliced into months
  // in memory: a cold five-year view is a handful of queries, not 60 builds.
  const runs = consecutiveRuns(missing);
  const [builtRuns, tail, names] = await Promise.all([
    mapLimit(runs, BUILD_CONCURRENCY, async (run) => {
      const loaded = stripForStorage(
        await deps.loadLive(propertyId, { from: run[0], to: endOfMonth(run[run.length - 1]) }),
      );
      return Promise.all(
        run.map(async (m) => {
          const facts = sliceToWindow(loaded, monthWindow(m));
          try {
            // Written with the generations read before the load: a change since is refused.
            await deps.store.write(propertyId, m, { month: gens!.months.get(m) ?? 0, hotel: gens!.hotel }, facts);
          } catch (error) {
            // The cache is an optimisation: a failed write must not fail the page.
            console.error("analytics month cache write failed", error);
            Sentry.captureException(error, { tags: { area: "analytics", surface: "month-cache", phase: "write" } });
          }
          return [m, facts] as const;
        }),
      );
    }),
    // The live months always run from the current month to the window's end: one load.
    live.length === 0
      ? Promise.resolve(null)
      : deps.loadLive(propertyId, { from: live[0] < window.from ? window.from : live[0], to: window.to }),
    deps.loadNames(propertyId),
  ]);
  const built = builtRuns.flat();

  // Oldest month first, live months last, so the live copy of a booking wins.
  const slices = new Map<IsoDate, Facts>();
  for (const [m, f] of cached) slices.set(m, f);
  for (const [m, f] of built) slices.set(m, f);
  if (tail) slices.set(live[0], tail);
  const ordered = [...slices.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, f]) => f);

  const bookings = new Map<string, BookingFact>();
  const nights = new Map<string, SoldNight>();
  const inventory = new Map<string, InventoryFact>();
  for (const f of ordered) {
    for (const b of f.bookings) bookings.set(b.id, b);
    for (const n of f.nights) nights.set(`${n.bookingId}|${n.date}`, n);
    for (const i of f.inventory) inventory.set(`${i.roomId}|${i.date}`, i);
  }

  const merged: Facts = {
    bookings: [...bookings.values()],
    nights: [...nights.values()],
    inventory: [...inventory.values()],
    roomTypeNames: names.roomTypeNames,
    ratePlanNames: names.ratePlanNames,
  };
  return sliceToWindow(merged, window);
}

/** The production wiring: Postgres store and the live loader. */
export async function loadFacts(propertyId: string, window: DateRange, today: IsoDate): Promise<Facts> {
  return assembleFacts(propertyId, window, today, {
    store: createMonthStore(),
    loadLive: loadWindowFacts,
    loadNames,
  });
}
