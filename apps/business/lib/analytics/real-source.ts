import { attachGuestDetails, guestWindow, loadGuestDetails } from "./guest-details";
import { loadFacts } from "./facts-cache";
import { loadHotelSpan } from "./facts-query";
import type { FactsSource } from "./get-analytics";

/** The loaders, injectable so the wiring is testable without a database. */
export interface RealSourceDeps {
  loadFacts: typeof loadFacts;
  loadHotelSpan: typeof loadHotelSpan;
  loadGuestDetails: typeof loadGuestDetails;
  attachGuestDetails: typeof attachGuestDetails;
}

const REAL: RealSourceDeps = { loadFacts, loadHotelSpan, loadGuestDetails, attachGuestDetails };

/**
 * Facts for one hotel. The property id is given by the caller, who got it from
 * the session; nothing here reads a request. Guest details load on the guests
 * page only.
 */
export function realFactsSource(propertyId: string, deps: RealSourceDeps = REAL): FactsSource {
  return async (page, window, today) => {
    const [facts, span, details] = await Promise.all([
      deps.loadFacts(propertyId, window, today),
      deps.loadHotelSpan(propertyId),
      page === "guests" ? deps.loadGuestDetails(propertyId, today) : Promise.resolve(null),
    ]);
    return {
      facts: details ? deps.attachGuestDetails(facts, details) : facts,
      earliest: span.earliest,
      hasAnyBookings: span.hasAnyBookings,
      guestWindowStart: page === "guests" ? guestWindow(today).from : null,
    };
  };
}
