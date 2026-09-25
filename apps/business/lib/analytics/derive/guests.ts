import type { Period } from "../period";
import {
  MIN_BOOKINGS_FOR_DETAIL,
  type BookingFact,
  type Category,
  type Facts,
  type GuestsSection,
} from "../types";
import { ratio } from "./totals";
import { widget } from "./widget";

export const OTHER_COUNTRY_KEY = "OTHER";

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

export function countryName(code: string): string {
  if (code === OTHER_COUNTRY_KEY) return "Other";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const createdIn = (bookings: BookingFact[], period: Period) =>
  bookings.filter(
    (b) => b.createdAt.slice(0, 10) >= period.from && b.createdAt.slice(0, 10) <= period.to,
  );

const stayed = (bookings: BookingFact[]) => bookings.filter((b) => b.status !== "cancelled");

export function deriveGuests(facts: Facts, period: Period): GuestsSection {
  const current = createdIn(facts.bookings, period);

  return {
    // Cancelled bookings brought nobody, so they cannot change the party size.
    averagePartySize: widget(() => {
      const kept = stayed(current);
      return ratio(kept.reduce((sum, b) => sum + b.adults + b.children, 0), kept.length);
    }),

    /**
     * Repeat is judged against the whole fact set, not the selected period. A
     * guest's second stay is their second stay regardless of which window the
     * host is looking at, so the generator has to carry history outside it.
     */
    repeatGuestPct: widget(() => {
      const earliestByGuest = new Map<string, string>();
      for (const b of stayed(facts.bookings)) {
        const seen = earliestByGuest.get(b.guestKey);
        if (!seen || b.checkIn < seen) earliestByGuest.set(b.guestKey, b.checkIn);
      }
      const kept = stayed(current);
      const repeats = kept.filter((b) => (earliestByGuest.get(b.guestKey) ?? b.checkIn) < b.checkIn);
      const r = ratio(repeats.length, kept.length);
      return r === null ? null : r * 100;
    }),

    /**
     * Countries under five bookings fold into "Other". A four-room B&B with one
     * guest from Japan would otherwise publish that guest's presence to anyone
     * who can see the screen — or who opens the exported CSV. The fold lives
     * here rather than in the component so the export cannot skip it.
     */
    countries: widget<Category[]>(() => {
      const counts = new Map<string, number>();
      for (const b of current) counts.set(b.guestCountry, (counts.get(b.guestCountry) ?? 0) + 1);

      let folded = 0;
      const named: Category[] = [];
      for (const [code, count] of counts) {
        if (count < MIN_BOOKINGS_FOR_DETAIL) folded += count;
        else named.push({ key: code, label: countryName(code), value: count });
      }

      named.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      // Other sits last whatever its size: it is a residual, not a destination,
      // and ranking it first would read as "most guests come from Other".
      return folded > 0
        ? [...named, { key: OTHER_COUNTRY_KEY, label: "Other", value: folded }]
        : named;
    }),
  };
}
