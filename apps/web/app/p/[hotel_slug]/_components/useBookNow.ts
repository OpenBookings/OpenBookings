"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { DbRoom } from "./constants";
import type { QuoteState, RoomView } from "../_lib/merge-quote";
import { pruneQuantities } from "../_lib/merge-quote";
import { guestsLabel, stayToParams, type Stay } from "../_lib/stay";
import {
  atHotelTotal,
  bookingMessage,
  buildBooking,
  encodeSelection,
  interpretBookResponse,
  nextBookStep,
  takePendingBook,
  type BookOutcome,
  type RoomExtras,
} from "../_lib/book";

/** A line for the bar that holds while the selection and stay stay as they were. */
type Notice = { key: string; text: string; total?: number };

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

/**
 * Book now: hold the picked rooms through POST /api/booking-intents and open
 * checkout, signing in first when needed. Signing in leaves the page, so the
 * picks go into the callback URL as `book`; back here with a session, they
 * are restored and Book now is pressed once more.
 */
export function useBookNow(i: {
  propertyId: string;
  stay: Stay | null;
  quote: QuoteState;
  /** Every room on the page, and their views. */
  rooms: DbRoom[];
  views: RoomView[];
  /** The rooms shown, and their views in the same order. */
  shownRooms: DbRoom[];
  shownViews: RoomView[];
  quantities: Record<string, number>;
  setQuantities: (q: Record<string, number>) => void;
  /** Cots and extra beds per room id, paid at the hotel. */
  extras: Record<string, RoomExtras>;
  /** The URL's search params as a string, and the page's path. */
  searchKey: string;
  pathname: string;
  askDates: () => void;
  showRates: () => void;
  reloadQuote: () => void;
}) {
  const { propertyId, stay, quote, rooms, views, shownRooms, shownViews, quantities, setQuantities, extras, searchKey, pathname, askDates, showRates, reloadQuote } = i;
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const signedIn = Boolean(session?.user);

  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signInURL, setSignInURL] = useState<string | null>(null);

  const stayKey = stay ? stayToParams(stay).toString() : "";
  const keyOf = useCallback((sel: Record<string, number>) => `${stayKey}|${encodeSelection(sel)}`, [stayKey]);
  const shownNotice = notice && notice.key === keyOf(quantities) ? notice : null;

  const book = useCallback(async (sel: Record<string, number>) => {
    const step = nextBookStep({ hasStay: stay !== null, pending: pendingRef.current });
    if (step === "ask_dates") return askDates();
    if (step === "ignore" || !stay) return;
    const booking = buildBooking(shownRooms, shownViews, sel, stay, extras);
    if (!booking.ok) return;

    const key = keyOf(sel);
    // After "the price changed", the guest has now seen the new total.
    const expectedTotal = notice?.key === key && notice.total !== undefined ? notice.total : booking.expectedTotal;
    const askSignIn = () => {
      const params = new URLSearchParams(searchKey);
      params.set("book", encodeSelection(sel));
      setSignInURL(`${pathname}?${params.toString()}#rooms`);
    };
    if (!sessionPending && !signedIn) return askSignIn();

    pendingRef.current = true;
    setPending(true);
    let outcome: BookOutcome;
    try {
      const res = await fetch("/api/booking-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: booking.rooms, expectedTotal }),
      });
      outcome = interpretBookResponse(res.status, await res.json().catch(() => null));
    } catch {
      outcome = interpretBookResponse(0, null);
    }
    // Checkout is on its way: the button stays pending until the page changes.
    if (outcome.kind === "go") return router.push(outcome.checkoutUrl);
    pendingRef.current = false;
    setPending(false);

    if (outcome.kind === "sign_in") return askSignIn();
    if (outcome.kind === "price_changed") {
      setNotice({ key, text: `The price changed to ${EURO.format(outcome.total)}. Press Book now to continue.`, total: outcome.total });
      return;
    }
    if (outcome.kind === "unavailable") {
      const gone = new Set(outcome.roomIds);
      const goneRates = new Set(rooms.filter((r) => gone.has(r.id)).flatMap((r) => r.rate_plans.map((p) => p.id)));
      const kept = Object.fromEntries(Object.entries(sel).filter(([rateId]) => !goneRates.has(rateId)));
      const names = rooms.filter((r) => gone.has(r.id)).map((r) => r.name);
      setQuantities(kept);
      setNotice({ key: keyOf(kept), text: names.length > 0 ? `Sorry, ${names.join(" and ")} was just booked.` : outcome.message });
      reloadQuote();
      return;
    }
    setNotice({ key, text: outcome.message });
  }, [stay, askDates, shownRooms, shownViews, extras, keyOf, notice, searchKey, pathname, sessionPending, signedIn, propertyId, router, rooms, setQuantities, reloadQuote]);

  // Back from signing in: restore the picks, take `book` out of the URL, and
  // press Book now once, if there is a session now.
  const bookParam = new URLSearchParams(searchKey).get("book");
  const consumed = useRef<string | null>(null);
  useEffect(() => {
    if (sessionPending || quote.status !== "ready") return;
    const pendingBook = takePendingBook(bookParam, consumed.current);
    consumed.current = pendingBook.consumed;
    if (!pendingBook.take) return;
    const params = new URLSearchParams(searchKey);
    params.delete("book");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    const sel = pruneQuantities(rooms, views, pendingBook.take);
    setQuantities(sel);
    showRates();
    if (signedIn) void book(sel);
  }, [bookParam, sessionPending, signedIn, quote.status, searchKey, pathname, router, rooms, views, setQuantities, showRates, book]);

  // What the bar shows.
  const booking = stay ? buildBooking(shownRooms, shownViews, quantities, stay, extras) : null;
  const pickGuests: Record<string, string> = {};
  let anyExtras = false;
  if (booking?.ok) {
    const byRate = new Map<string, { adults: number; children: number; infants: number; cots: number; extraBeds: number }>();
    for (const r of booking.rooms) {
      const g = byRate.get(r.ratePlanId) ?? { adults: 0, children: 0, infants: 0, cots: 0, extraBeds: 0 };
      byRate.set(r.ratePlanId, {
        adults: g.adults + r.adults,
        children: g.children + r.children,
        infants: g.infants + r.infants,
        cots: g.cots + r.cots,
        extraBeds: g.extraBeds + r.extraBeds,
      });
    }
    for (const [rateId, g] of byRate) {
      const beds = [
        g.cots > 0 && `${g.cots} ${g.cots === 1 ? "cot" : "cots"}`,
        g.extraBeds > 0 && `${g.extraBeds} extra ${g.extraBeds === 1 ? "bed" : "beds"}`,
      ].filter(Boolean);
      if (beds.length > 0) anyExtras = true;
      pickGuests[rateId] = [guestsLabel(g), ...beds].join(" · ");
    }
  }
  const atHotel = anyExtras && stay ? atHotelTotal(shownRooms, quantities, extras, stay.nights) : null;
  const problem = booking && stay ? bookingMessage(booking, shownRooms, shownViews, quantities, stay) : null;

  return {
    bar: {
      pickGuests,
      message: shownNotice?.text ?? problem,
      totalOverride: shownNotice?.total ?? null,
      keepOpen: shownNotice !== null,
      atHotel,
      // Without dates Book now asks for them; with dates the selection must be bookable.
      canBook: booking === null || booking.ok,
      pending,
      onBook: () => void book(quantities),
    },
    signInURL,
    closeSignIn: () => setSignInURL(null),
  };
}
