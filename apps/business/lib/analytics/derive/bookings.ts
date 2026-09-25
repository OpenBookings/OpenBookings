import { addDays, comparisonRange, daysBetween, type Period } from "../period";
import type {
  BookingFact,
  BookingsSection,
  Facts,
  IsoDate,
  UpcomingWindow,
} from "../types";
import { makeDelta } from "./delta";
import { inRange, ratio } from "./totals";
import { widget } from "./widget";

export const LEAD_TIME_BUCKETS = [
  { key: "0-1", label: "0–1 days", max: 1 },
  { key: "2-7", label: "2–7 days", max: 7 },
  { key: "8-30", label: "8–30 days", max: 30 },
  { key: "31-90", label: "31–90 days", max: 90 },
  { key: "90+", label: "90+ days", max: Number.POSITIVE_INFINITY },
] as const;

const createdIn = (bookings: BookingFact[], from: IsoDate, to: IsoDate) =>
  bookings.filter((b) => b.createdAt.slice(0, 10) >= from && b.createdAt.slice(0, 10) <= to);

const stayed = (bookings: BookingFact[]) => bookings.filter((b) => b.status !== "cancelled");

export function deriveBookings(
  facts: Facts,
  period: Period,
  today: IsoDate,
): BookingsSection {
  const current = createdIn(facts.bookings, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? createdIn(facts.bookings, comparison.from, comparison.to) : [];

  const cancelledCount = current.filter((b) => b.status === "cancelled").length;
  const cancelledPct = ratio(cancelledCount, current.length);
  const previousCancelledPct = comparison
    ? ratio(previous.filter((b) => b.status === "cancelled").length, previous.length)
    : null;

  return {
    count: widget(() => ({
      value: current.length,
      delta: makeDelta(current.length, comparison ? previous.length : null),
    })),
    // Cancelled stays never happened, so they cannot lengthen the average one.
    averageLengthOfStay: widget(() => {
      const kept = stayed(current);
      return ratio(kept.reduce((sum, b) => sum + b.nights, 0), kept.length);
    }),
    cancellations: widget(() => ({
      count: cancelledCount,
      value: cancelledPct === null ? 0 : cancelledPct * 100,
      // Inverted: more cancellations is worse, and the colour has to know.
      delta: makeDelta(
        cancelledPct === null ? null : cancelledPct * 100,
        previousCancelledPct === null ? null : previousCancelledPct * 100,
        "down",
      ),
    })),
    leadTime: widget(() => {
      const counts = new Map<string, number>(
        LEAD_TIME_BUCKETS.map((b) => [b.key, 0] as [string, number]),
      );
      for (const b of current) {
        // A booking made after check-in is same-day, not negative days out.
        const lead = Math.max(0, daysBetween(b.createdAt.slice(0, 10), b.checkIn) - 1);
        const bucket = LEAD_TIME_BUCKETS.find((candidate) => lead <= candidate.max)!;
        counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
      }
      return LEAD_TIME_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        value: counts.get(b.key) ?? 0,
      }));
    }),
    // Always from today: a host asking "what does my next month look like" is
    // not asking about whichever period happens to be selected.
    upcoming: widget<UpcomingWindow[]>(() =>
      ([30, 60, 90] as const).map((window) => {
        const nights = inRange(facts.nights, today, addDays(today, window - 1));
        const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
        const total = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
        return {
          window,
          label: `Next ${window} days`,
          nightsSold: sold,
          // What is still sellable, not the whole pool — the stacked bar reads
          // as sold against remaining, and those must add up to inventory.
          nightsAvailable: total - sold,
        };
      }),
    ),
  };
}
