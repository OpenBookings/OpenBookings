import { formatDayMonth } from "../format";
import { addDays, comparisonRange, granularityFor, type Period } from "../period";
import type { Facts, Heatmap, HeatCell, NightFact, SellThroughSection } from "../types";
import { emptyBuckets, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { inRange, ratio, sumNightsAvailable, sumNightsSold } from "./totals";
import { widget } from "./widget";

/** Sell-through as a percentage, or null when there was no inventory to sell. */
function pctOf(nights: NightFact[]): number | null {
  const r = ratio(sumNightsSold(nights), sumNightsAvailable(nights));
  return r === null ? null : r * 100;
}

/**
 * Rows Mon–Sun, one column per week the period touches. A cell with no
 * inventory behind it reports null rather than zero — the difference between
 * "nothing sold" and "nothing was on sale" is the whole value of the widget to
 * a host deciding whether to open more rooms.
 */
export function buildHeatmap(nights: NightFact[], period: Period): Heatmap {
  const scoped = inRange(nights, period.from, period.to);
  const byDate = new Map<string, { sold: number; available: number }>();
  for (const night of scoped) {
    const entry = byDate.get(night.date) ?? { sold: 0, available: 0 };
    entry.sold += night.unitsSold;
    entry.available += night.unitsAvailable;
    byDate.set(night.date, entry);
  }

  const weeks = emptyBuckets(period.from, period.to, "week").map((start) => ({
    start,
    label: weekLabel(start),
  }));

  const cells: HeatCell[] = [];
  for (const week of weeks) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      const date = addDays(week.start, weekday - 1);
      const entry = byDate.get(date) ?? { sold: 0, available: 0 };
      const r = ratio(entry.sold, entry.available);
      cells.push({
        weekStart: week.start,
        weekday,
        pct: r === null ? null : r * 100,
        nightsSold: entry.sold,
        nightsAvailable: entry.available,
      });
    }
  }

  return { weeks, cells };
}

function weekLabel(start: string): string {
  return formatDayMonth(start);
}

export function deriveSellThrough(facts: Facts, period: Period): SellThroughSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? inRange(facts.nights, comparison.from, comparison.to) : [];

  const byRoom = new Map<string, { sold: number; available: number }>();
  for (const night of current) {
    const entry = byRoom.get(night.roomId) ?? { sold: 0, available: 0 };
    entry.sold += night.unitsSold;
    entry.available += night.unitsAvailable;
    byRoom.set(night.roomId, entry);
  }

  return {
    pct: widget(() => ({
      value: pctOf(current),
      delta: makeDelta(pctOf(current), comparison ? pctOf(previous) : null),
    })),
    roomsSold: widget(() => sumNightsSold(current)),
    overTime: widget(() => {
      // Bucketed as sold-over-available per bucket, not as a mean of nightly
      // percentages: a night with two rooms open must not weigh as much as a
      // night with twelve.
      const sold = toSeries(current, {
        date: (n) => n.date, value: (n) => n.unitsSold,
        from: period.from, to: period.to, granularity,
      });
      const available = toSeries(current, {
        date: (n) => n.date, value: (n) => n.unitsAvailable,
        from: period.from, to: period.to, granularity,
      });
      return sold.map((point, i) => {
        const r = ratio(point.value, available[i].value);
        return { ...point, value: r === null ? 0 : r * 100 };
      });
    }),
    byRoomType: widget(() =>
      [...byRoom.entries()]
        .map(([key, { sold, available }]) => {
          const r = ratio(sold, available);
          return {
            key,
            label: facts.roomTypeNames[key] ?? key,
            value: r === null ? 0 : r * 100,
          };
        })
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    ),
    busiestDays: widget(() => buildHeatmap(facts.nights, period)),
  };
}
