import {
  bookingsCreatedIn, isCancelled, keptBookings, leadDays, median, MIN_SAMPLE, pct, sum,
} from "../metrics";
import { daysBetween } from "../period";
import type { Bar, BookingFact, BookingPatternsView, CancellationRow, DeriveContext } from "../types";
import { makeDelta } from "./delta";
import { widget } from "./widget";

interface BucketDef {
  key: string;
  label: string;
  /** Inclusive upper bound. */
  max: number;
}

export const LEAD_BUCKETS: readonly BucketDef[] = [
  { key: "same-day", label: "Same day", max: 0 },
  { key: "1-3", label: "1–3 days", max: 3 },
  { key: "4-7", label: "4–7 days", max: 7 },
  { key: "8-14", label: "8–14 days", max: 14 },
  { key: "15-30", label: "15–30 days", max: 30 },
  { key: "31-60", label: "31–60 days", max: 60 },
  { key: "61+", label: "61+ days", max: Number.POSITIVE_INFINITY },
];

export const STAY_BUCKETS: readonly BucketDef[] = [
  { key: "1", label: "1 night", max: 1 },
  { key: "2", label: "2 nights", max: 2 },
  { key: "3", label: "3 nights", max: 3 },
  { key: "4-6", label: "4–6 nights", max: 6 },
  { key: "7+", label: "7+ nights", max: Number.POSITIVE_INFINITY },
];

function histogram(values: number[], defs: readonly BucketDef[]): Bar[] {
  const bars = defs.map((def) => ({ key: def.key, label: def.label, value: 0 }));
  for (const value of values) bars[defs.findIndex((def) => value <= def.max)].value += 1;
  return bars;
}

/** Whole days between the cancellation and check-in. A late cancellation is same-day. */
const daysBeforeCheckIn = (b: BookingFact): number =>
  Math.max(0, daysBetween(b.cancelledAt!.slice(0, 10), b.checkIn) - 1);

const cancellationRate = (bookings: BookingFact[]): number | null =>
  pct(bookings.filter(isCancelled).length, bookings.length);

export function deriveBookingPatterns(ctx: DeriveContext): BookingPatternsView {
  const { facts, period, comparison } = ctx;

  const created = bookingsCreatedIn(facts.bookings, period);
  const kept = keptBookings(created);
  const cancelled = created.filter(isCancelled);
  const prev = comparison ? bookingsCreatedIn(facts.bookings, comparison) : null;

  const medianLead = (rows: BookingFact[]) => median(rows.map(leadDays));
  const medianStay = (rows: BookingFact[]) => median(keptBookings(rows).map((b) => b.nights));

  return {
    bookings: widget("booking", created.length, () => ({
      value: created.length,
      delta: makeDelta(created.length, prev ? prev.length : null),
    })),
    medianLeadDays: widget("booking", created.length, () => ({
      value: medianLead(created),
      delta: makeDelta(medianLead(created), prev ? medianLead(prev) : null, "neutral"),
    })),
    medianStayNights: widget("booking", kept.length, () => ({
      value: medianStay(created),
      delta: makeDelta(medianStay(created), prev ? medianStay(prev) : null, "neutral"),
    })),
    cancellationRate: widget("booking", created.length, () => ({
      value: cancellationRate(created),
      delta: makeDelta(cancellationRate(created), prev ? cancellationRate(prev) : null, "neutral"),
    })),
    leadTime: widget("booking", created.length, () => histogram(created.map(leadDays), LEAD_BUCKETS), MIN_SAMPLE),
    stayLength: widget("booking", kept.length, () => histogram(kept.map((b) => b.nights), STAY_BUCKETS), MIN_SAMPLE),
    cancellationsByDaysBefore: widget(
      "booking",
      cancelled.length,
      () => histogram(cancelled.map(daysBeforeCheckIn), LEAD_BUCKETS),
      MIN_SAMPLE,
    ),
    byRatePlan: widget(
      "booking",
      created.length,
      () => {
        const plans = new Map<string, BookingFact[]>();
        for (const b of created) {
          const rows = plans.get(b.ratePlanId);
          if (rows) rows.push(b);
          else plans.set(b.ratePlanId, [b]);
        }
        return [...plans.entries()]
          .map(([key, rows]): CancellationRow => {
            const lost = rows.filter(isCancelled);
            return {
              key,
              label: facts.ratePlanNames[key] ?? key,
              bookings: rows.length,
              cancelled: lost.length,
              ratePct: pct(lost.length, rows.length),
              feesRetainedCents: sum(lost, (b) => b.cancellationFeeCents),
            };
          })
          .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label));
      },
      MIN_SAMPLE,
    ),
  };
}
