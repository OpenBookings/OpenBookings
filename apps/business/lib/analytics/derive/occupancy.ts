import { formatDayMonth, WEEKDAY_NAMES } from "../format";
import {
  bookingDate, earliestFactDate, inventoryIn, MIN_SAMPLE, nightsAvailable, nightsIn,
  occupancyPct, pct,
} from "../metrics";
import { addDays, daysBetween, enumerateDates, weekdayOf, type DateRange } from "../period";
import type {
  BookingFact, DeriveContext, Granularity, InventoryFact, IsoDate, OccupancyView, Point, SoldNight,
} from "../types";
import { bucketKey, overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

const PACE_WEEKS = 13;
/** 52 whole weeks, so last year's week starts on the same weekday. */
const YEAR_OF_WEEKS = 364;

const unitsInService = (i: InventoryFact): number => Math.max(0, i.unitsTotal - i.unitsOutOfOrder);

/** Sold over available per bucket. Null where nothing was available. */
function occupancySeries(
  nights: SoldNight[],
  inventory: InventoryFact[],
  range: DateRange,
  granularity: Granularity,
  today: IsoDate,
): Point[] {
  const available = new Map<IsoDate, number>();
  for (const i of inventory) {
    const key = bucketKey(i.date, granularity);
    available.set(key, (available.get(key) ?? 0) + unitsInService(i));
  }
  return toSeries(nights, (n) => n.date, range, granularity, today, (rows, bucket) =>
    pct(rows.length, available.get(bucket.key) ?? 0),
  );
}

/** Nights in `range` held by bookings that existed, uncancelled, on `asOf`. */
function onTheBooks(bookings: BookingFact[], asOf: IsoDate, range: DateRange): number {
  let count = 0;
  for (const b of bookings) {
    if (bookingDate(b) > asOf) continue;
    if (b.cancelledAt !== null && b.cancelledAt.slice(0, 10) <= asOf) continue;
    const lastNight = addDays(b.checkOut, -1);
    const from = b.checkIn > range.from ? b.checkIn : range.from;
    const to = lastNight < range.to ? lastNight : range.to;
    if (from <= to) count += daysBetween(from, to);
  }
  return count;
}

export function deriveOccupancy(ctx: DeriveContext): OccupancyView {
  const { facts, period, comparison, today, granularity } = ctx;

  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const prevInv = comparison ? inventoryIn(facts.inventory, comparison) : null;

  // Weekly at most: a monthly occupancy line hides the weekends it is for.
  const lineGranularity: Granularity = granularity === "month" ? "week" : granularity;

  const next30: DateRange = { from: today, to: addDays(today, 29) };
  const next90: DateRange = { from: today, to: addDays(today, 89) };
  const next90Inventory = inventoryIn(facts.inventory, next90);

  const earliest = earliestFactDate(facts);
  const hasYearOfHistory = earliest !== null && earliest <= addDays(today, -YEAR_OF_WEEKS);
  const paceRange: DateRange = { from: today, to: addDays(today, PACE_WEEKS * 7 - 1) };

  return {
    occupancy: widget("stay", nights.length, () => ({
      value: occupancyPct(nights, inv),
      delta: makeDelta(
        occupancyPct(nights, inv),
        prevNights && prevInv ? occupancyPct(prevNights, prevInv) : null,
      ),
    })),
    nightsSold: widget("stay", nights.length, () => ({
      value: nights.length,
      delta: makeDelta(nights.length, prevNights ? prevNights.length : null),
    })),
    nightsAvailable: widget("stay", nights.length, () => ({ value: nightsAvailable(inv), delta: null })),
    // Always from today: "what is still unsold" is not a question about the period.
    unsoldNext30: widget("stay", nights.length, () => ({
      value: nightsAvailable(inventoryIn(facts.inventory, next30)) - nightsIn(facts.nights, next30).length,
      delta: null,
    })),
    overTime: widget("stay", nights.length, () =>
      overlay(
        occupancySeries(nights, inv, period, lineGranularity, today),
        prevNights && prevInv && comparison
          ? occupancySeries(prevNights, prevInv, comparison, lineGranularity, today)
          : null,
      ),
    ),
    overTimeGranularity: lineGranularity,
    next90: widget("stay", nightsAvailable(next90Inventory), () => {
      const sold = new Map<IsoDate, number>();
      for (const n of nightsIn(facts.nights, next90)) sold.set(n.date, (sold.get(n.date) ?? 0) + 1);
      const available = new Map<IsoDate, number>();
      for (const i of next90Inventory) available.set(i.date, (available.get(i.date) ?? 0) + unitsInService(i));
      return enumerateDates(next90.from, next90.to).map((date) => ({
        date,
        sold: sold.get(date) ?? 0,
        available: available.get(date) ?? 0,
        weekend: weekdayOf(date) === 5 || weekdayOf(date) === 6,
      }));
    }),
    pace: hasYearOfHistory
      ? widget("stay", onTheBooks(facts.bookings, today, paceRange), () =>
          Array.from({ length: PACE_WEEKS }, (_, week) => {
            const from = addDays(today, week * 7);
            const range = { from, to: addDays(from, 6) };
            const lastYear = { from: addDays(range.from, -YEAR_OF_WEEKS), to: addDays(range.to, -YEAR_OF_WEEKS) };
            return {
              bucket: from,
              label: formatDayMonth(from),
              value: onTheBooks(facts.bookings, today, range),
              compare: onTheBooks(facts.bookings, addDays(today, -YEAR_OF_WEEKS), lastYear),
              incomplete: false,
            };
          }),
        )
      : null,
    byWeekday: widget(
      "stay",
      nights.length,
      () =>
        WEEKDAY_NAMES.map((label, index) => {
          const weekday = index + 1;
          const sold = nights.filter((n) => weekdayOf(n.date) === weekday).length;
          const available = nightsAvailable(inv.filter((i) => weekdayOf(i.date) === weekday));
          return { key: String(weekday), label, value: pct(sold, available) ?? 0 };
        }),
      MIN_SAMPLE,
    ),
  };
}
