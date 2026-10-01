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

interface Segment {
  key: string;
  label: string;
  value: number;
  guests: Set<string>;
}

/**
 * Bookings per segment, with small segments folded into Other. Three rules,
 * all counted in distinct guests and not bookings, because five bookings from
 * one regular would otherwise put that guest's country on screen and in the CSV:
 *
 * 1. A segment backed by fewer than five guests is folded.
 * 2. Other itself must be backed by at least five guests, or it is the small
 *    segment under another name. The smallest named segment joins it until it is.
 * 3. In a closed set (group types: everyone knows the four), a single folded
 *    segment can be named by elimination, so Other must hold at least two.
 *
 * The fold lives here, in the view model, so no consumer can skip it.
 */
function suppressedShares(
  rows: BookingFact[],
  key: (b: BookingFact) => string,
  label: (key: string) => string,
  top: number,
  closedSet: boolean,
): Share[] {
  const segments = new Map<string, Segment>();
  for (const b of rows) {
    const k = key(b);
    const segment = segments.get(k) ?? { key: k, label: label(k), value: 0, guests: new Set<string>() };
    segment.value += 1;
    segment.guests.add(b.guestKey);
    segments.set(k, segment);
  }

  const ranked = [...segments.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label),
  );
  const named = ranked.filter((segment) => segment.guests.size >= MIN_SAMPLE).slice(0, top);
  const folded = ranked.filter((segment) => !named.includes(segment));

  const otherGuests = () => new Set(folded.flatMap((segment) => [...segment.guests])).size;
  const otherIsExposed = () =>
    folded.length > 0 && (otherGuests() < MIN_SAMPLE || (closedSet && folded.length < 2));
  while (otherIsExposed() && named.length > 0) folded.push(named.pop()!);

  const other = sum(folded, (segment) => segment.value);
  const all = [
    ...named.map(({ key: k, label: l, value }) => ({ key: k, label: l, value })),
    ...(other > 0 ? [{ key: OTHER_KEY, label: "Other", value: other }] : []),
  ];
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
      () => suppressedShares(kept, (b) => b.guestCountry, countryName, TOP_N, false),
      MIN_SAMPLE,
    ),
    groupTypes: widget(
      "booking",
      distinctGuests,
      () => suppressedShares(kept, groupTypeOf, (key) => GROUP_LABELS[key as GroupType], 4, true),
      MIN_SAMPLE,
    ),
  };
}
