import {
  bookingsCreatedIn, groupTypeOf, keptBookings, median, MIN_SAMPLE, OTHER_KEY, pct, sum, TOP_N,
} from "../metrics";
import type { BookingFact, DeriveContext, GroupType, GuestsView, IsoDate, Share } from "../types";
import { makeDelta } from "./delta";
import { widget } from "./widget";

const GROUP_LABELS: Record<GroupType, string> = {
  solo: "Solo",
  couple: "Couple",
  family: "Family",
  group: "Group",
};

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Bookings per segment, with any segment backed by fewer than five distinct
 * guests folded into Other. The threshold is on guests, not bookings: five
 * bookings from one regular would otherwise put that guest's country on screen
 * and in the CSV. The fold lives here, in the view model, so no consumer can
 * skip it.
 */
function suppressedShares(
  rows: BookingFact[],
  key: (b: BookingFact) => string,
  label: (key: string) => string,
  top: number,
): Share[] {
  const segments = new Map<string, { bookings: number; guests: Set<string> }>();
  for (const b of rows) {
    const segment = segments.get(key(b)) ?? { bookings: 0, guests: new Set<string>() };
    segment.bookings += 1;
    segment.guests.add(b.guestKey);
    segments.set(key(b), segment);
  }

  let folded = 0;
  const named: { key: string; label: string; value: number }[] = [];
  for (const [segmentKey, segment] of segments) {
    if (segment.guests.size < MIN_SAMPLE) folded += segment.bookings;
    else named.push({ key: segmentKey, label: label(segmentKey), value: segment.bookings });
  }
  named.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const head = named.slice(0, top);
  const other = folded + sum(named.slice(top), (row) => row.value);
  const all = other > 0 ? [...head, { key: OTHER_KEY, label: "Other", value: other }] : head;
  const total = sum(all, (row) => row.value);
  return all.map((row) => ({ ...row, sharePct: pct(row.value, total) ?? 0 }));
}

export function deriveGuests(ctx: DeriveContext): GuestsView {
  const { facts, period, comparison } = ctx;

  // One population for every figure on the page: kept bookings made in the period.
  const kept = keptBookings(bookingsCreatedIn(facts.bookings, period));
  const prevKept = comparison ? keptBookings(bookingsCreatedIn(facts.bookings, comparison)) : null;
  const distinctGuests = new Set(kept.map((b) => b.guestKey)).size;

  // A guest's first stay, across all history: a second stay is a second stay
  // whichever window the host is looking at.
  const firstStay = new Map<string, IsoDate>();
  for (const b of keptBookings(facts.bookings)) {
    const seen = firstStay.get(b.guestKey);
    if (seen === undefined || b.checkIn < seen) firstStay.set(b.guestKey, b.checkIn);
  }
  const returningPct = (rows: BookingFact[]): number | null =>
    pct(rows.filter((b) => (firstStay.get(b.guestKey) ?? b.checkIn) < b.checkIn).length, rows.length);
  const partySize = (rows: BookingFact[]): number | null =>
    median(rows.map((b) => b.adults + b.children));

  return {
    returning: widget("booking", kept.length, () => ({
      value: returningPct(kept),
      delta: makeDelta(returningPct(kept), prevKept ? returningPct(prevKept) : null),
    })),
    medianPartySize: widget("booking", kept.length, () => ({
      value: partySize(kept),
      delta: makeDelta(partySize(kept), prevKept ? partySize(prevKept) : null, "neutral"),
    })),
    countries: widget(
      "booking",
      distinctGuests,
      () => suppressedShares(kept, (b) => b.guestCountry, countryName, TOP_N),
      MIN_SAMPLE,
    ),
    groupTypes: widget(
      "booking",
      distinctGuests,
      () => suppressedShares(kept, groupTypeOf, (key) => GROUP_LABELS[key as GroupType], 4),
      MIN_SAMPLE,
    ),
  };
}
