import { comparisonRange, granularityFor, type Period } from "../period";
import type { Facts, IsoDate, RevenueSection } from "../types";
import { toSeries } from "./buckets";
import { makeDelta } from "./delta";
import {
  COMMISSION_RATE,
  groupSum,
  inRange,
  rank,
  ratio,
  sumNightsAvailable,
  sumNightsSold,
  sumRevenueCents,
} from "./totals";
import { widget } from "./widget";

export function deriveRevenue(
  facts: Facts,
  period: Period,
  today: IsoDate,
): RevenueSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? inRange(facts.nights, comparison.from, comparison.to) : [];

  const revenueCents = sumRevenueCents(current);
  const sold = sumNightsSold(current);
  const available = sumNightsAvailable(current);

  // Year to date ignores the selector by design: it is the one figure a host
  // reads without first checking which period is on screen.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const ytdCents = sumRevenueCents(inRange(facts.nights, yearStart, today));
  const lastYearCents = sumRevenueCents(
    inRange(
      facts.nights,
      `${Number(today.slice(0, 4)) - 1}-01-01`,
      `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`,
    ),
  );

  return {
    yearToDateCents: widget(() => ({
      value: ytdCents,
      delta: makeDelta(ytdCents, lastYearCents === 0 ? null : lastYearCents),
    })),
    periodCents: widget(() => ({
      value: revenueCents,
      delta: makeDelta(revenueCents, comparison ? sumRevenueCents(previous) : null),
    })),
    // ADR over nights SOLD; RevPAR over nights AVAILABLE. When nothing sold,
    // ADR has no answer — reporting €0 would say rooms went for nothing —
    // while RevPAR legitimately is €0, because the rooms were there and earned.
    adrCents: widget(() => ({
      value: ratio(revenueCents, sold),
      spark: toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    })),
    revparCents: widget(() => ({
      value: ratio(revenueCents, available),
      spark: toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    })),
    overTime: widget(() =>
      toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    ),
    byRoomType: widget(() =>
      rank(groupSum(current, (n) => n.roomId, (n) => n.netRevenueCents), facts.roomTypeNames),
    ),
    byRatePlan: widget(() =>
      rank(groupSum(current, (n) => n.ratePlanId, (n) => n.netRevenueCents), facts.ratePlanNames),
    ),
    // Rounded once, over the total. Rounding per night drifts by up to a cent a
    // night, which on four thousand room-nights visibly disagrees with 4.5% of
    // the revenue figure printed directly above it.
    commissionCents: widget(() => Math.round(revenueCents * COMMISSION_RATE)),
  };
}
