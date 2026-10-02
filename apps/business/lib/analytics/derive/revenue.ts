import {
  adrCents, bookingDate, bookingsCreatedIn, commissionCents, earliestFactDate, groupSum,
  inventoryIn, keptBookings, nightsIn, revenueCents, revparCents, shares,
} from "../metrics";
import { shiftYears, type DateRange } from "../period";
import type { BookingFact, DeriveContext, RevenueView } from "../types";
import { overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

export function deriveRevenue(ctx: DeriveContext): RevenueView {
  const { facts, period, comparison, today, granularity } = ctx;

  // Booking-date basis: what was booked in the period.
  const keptIn = (range: DateRange): BookingFact[] =>
    keptBookings(bookingsCreatedIn(facts.bookings, range));
  const kept = keptIn(period);
  const prevKept = comparison ? keptIn(comparison) : null;
  const revenue = revenueCents(kept);

  // Stay-date basis: ADR and RevPAR need nights as their denominator.
  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const prevInv = comparison ? inventoryIn(facts.inventory, comparison) : null;

  // Year to date ignores the period by design: it is the one figure a host
  // reads without first checking which period is on screen.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const ytdKept = keptIn({ from: yearStart, to: today });
  const lastYtd = { from: shiftYears(yearStart, -1), to: shiftYears(today, -1) };
  const earliest = earliestFactDate(facts);
  const ytdComparable = comparison !== null && earliest !== null && earliest <= lastYtd.from;

  return {
    revenue: widget("booking", kept.length, () => ({
      value: revenue,
      delta: makeDelta(revenue, prevKept ? revenueCents(prevKept) : null),
    })),
    yearToDate: widget("booking", ytdKept.length, () => {
      const value = revenueCents(ytdKept);
      return { value, delta: makeDelta(value, ytdComparable ? revenueCents(keptIn(lastYtd)) : null) };
    }),
    adr: widget("stay", nights.length, () => ({
      value: adrCents(nights),
      delta: makeDelta(adrCents(nights), prevNights ? adrCents(prevNights) : null),
    })),
    revpar: widget("stay", nights.length, () => ({
      value: revparCents(nights, inv),
      delta: makeDelta(
        revparCents(nights, inv),
        prevNights && prevInv ? revparCents(prevNights, prevInv) : null,
      ),
    })),
    commission: widget("booking", kept.length, () => ({ value: commissionCents(revenue), delta: null })),
    overTime: widget("booking", kept.length, () =>
      overlay(
        toSeries(kept, bookingDate, period, granularity, today, revenueCents),
        prevKept && comparison
          ? toSeries(prevKept, bookingDate, comparison, granularity, today, revenueCents)
          : null,
      ),
    ),
    byRoomType: widget("booking", kept.length, () =>
      shares(groupSum(kept, (b) => b.roomId, (b) => b.netRevenueCents), facts.roomTypeNames),
    ),
    byRatePlan: widget("booking", kept.length, () =>
      shares(groupSum(kept, (b) => b.ratePlanId, (b) => b.netRevenueCents), facts.ratePlanNames),
    ),
  };
}
