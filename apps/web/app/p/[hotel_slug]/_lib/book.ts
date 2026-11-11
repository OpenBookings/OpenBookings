import type { SelectedRoom } from "@/lib/booking/quote";
import { MAX_ROOMS } from "@/lib/booking/stay-input";
import type { DbRoom } from "../_components/constants";
import type { RoomView } from "./merge-quote";
import { splitParty, type SplitResult, type Unit } from "./split-party";
import { guestsLabel } from "./stay";

// ── The selection in the URL ──────────────────────────────────────────────────
// Signing in leaves the page, so the picks ride along in `book` and Book now
// is pressed again on the way back.

const ID = /^[0-9A-Za-z-]+$/;

/** "ratePlanId:qty,…", empty picks left out. */
export function encodeSelection(sel: Record<string, number>): string {
  return Object.entries(sel)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");
}

/** The picks in a `book` param. Anything malformed is left out. */
export function decodeSelection(s: string | null): Record<string, number> {
  const sel: Record<string, number> = {};
  for (const part of (s ?? "").split(",")) {
    const [id, qty, ...rest] = part.split(":");
    if (rest.length > 0 || !id || !ID.test(id) || !/^\d+$/.test(qty ?? "")) continue;
    const n = Number(qty);
    if (n >= 1 && n <= MAX_ROOMS) sel[id] = n;
  }
  return sel;
}

/**
 * Whether a `book` param should be acted on: once per param, and again only
 * after it has left the URL. `consumed` is what the last call returned.
 */
export function takePendingBook(
  book: string | null,
  consumed: string | null,
): { take: Record<string, number> | null; consumed: string | null } {
  if (!book) return { take: null, consumed: null };
  if (book === consumed) return { take: null, consumed };
  const sel = decodeSelection(book);
  return { take: Object.keys(sel).length > 0 ? sel : null, consumed: book };
}

// ── Pressing Book now ─────────────────────────────────────────────────────────

/** Without dates there is nothing to book yet; while a request is out, a second press does nothing. */
export function nextBookStep(i: { hasStay: boolean; pending: boolean }): "ask_dates" | "ignore" | "post" {
  if (i.pending) return "ignore";
  if (!i.hasStay) return "ask_dates";
  return "post";
}

export type Booking =
  | { ok: true; rooms: SelectedRoom[]; expectedTotal: number }
  | { ok: false; reason: "unpriced" }
  | Extract<SplitResult, { ok: false }>;

/**
 * The rooms a selection books, the party split over them, and the total the
 * guest was shown. `views` line up with `rooms`.
 */
export function buildBooking(
  rooms: DbRoom[],
  views: RoomView[],
  sel: Record<string, number>,
  party: { adults: number; children: number; infants?: number },
): Booking {
  const units: Unit[] = [];
  let total = 0;
  rooms.forEach((room, i) => {
    const view = views[i];
    for (const rate of room.rate_plans) {
      const qty = sel[rate.id] ?? 0;
      if (qty === 0) continue;
      const priced = view?.rates[rate.id];
      if (!priced || view.maxAdults === null || view.maxChildren === null) {
        total = NaN;
        continue;
      }
      total += qty * priced.total;
      for (let n = 0; n < qty; n++) {
        units.push({ roomId: room.id, ratePlanId: rate.id, maxAdults: view.maxAdults, maxChildren: view.maxChildren });
      }
    }
  });
  if (Number.isNaN(total)) return { ok: false, reason: "unpriced" };
  const split = splitParty(party, units);
  if (!split.ok) return split;
  return { ok: true, rooms: split.rooms, expectedTotal: Math.round(total * 100) / 100 };
}

/**
 * The selection bar's one line on why a selection cannot be booked as it
 * stands, or null when it can (or is only waiting for prices).
 */
export function bookingMessage(
  b: Booking,
  rooms: DbRoom[],
  views: RoomView[],
  sel: Record<string, number>,
  party: { adults: number; children: number; infants?: number },
): string | null {
  if (b.ok || b.reason === "unpriced") return null;
  if (b.reason === "too_many_rooms") return "One room per adult at most";
  if (b.reason === "does_not_fit") {
    const i = rooms.findIndex((r) => r.id === b.roomId);
    const view = views[i];
    if (i < 0 || view?.maxAdults == null) return null;
    return `${rooms[i].name} sleeps ${guestsLabel({ adults: view.maxAdults, children: view.maxChildren ?? 0 })}`;
  }
  let count = 0;
  let adults = 0;
  let children = 0;
  rooms.forEach((room, i) => {
    for (const rate of room.rate_plans) {
      const qty = sel[rate.id] ?? 0;
      count += qty;
      adults += qty * (views[i]?.maxAdults ?? 0);
      children += qty * (views[i]?.maxChildren ?? 0);
    }
  });
  const sleeps = count === 1 ? "1 room sleeps" : `${count} rooms sleep`;
  // Children only come into it when the party has them.
  const upTo = party.children > 0 ? guestsLabel({ adults, children }) : String(adults);
  return `Add a room — ${sleeps} up to ${upTo}`;
}

// ── The answer ────────────────────────────────────────────────────────────────

export type BookOutcome =
  | { kind: "go"; checkoutUrl: string }
  | { kind: "sign_in" }
  | { kind: "price_changed"; total: number }
  | { kind: "unavailable"; roomIds: string[]; message: string }
  | { kind: "error"; message: string };

const SOMETHING_WENT_WRONG: BookOutcome = { kind: "error", message: "Something went wrong. Please try again." };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** What `POST /api/booking-intents` answered, in the guest's terms. Never a code. */
export function interpretBookResponse(status: number, body: unknown): BookOutcome {
  const b = isObject(body) ? body : {};
  if (status === 201) {
    const url = b.checkoutUrl;
    // Only our own checkout: the URL is navigated to.
    return typeof url === "string" && url.startsWith("/checkout/") ? { kind: "go", checkoutUrl: url } : SOMETHING_WENT_WRONG;
  }
  if (status === 401) return { kind: "sign_in" };
  if (status === 409 && b.error === "price_changed") {
    const total = isObject(b.quote) ? b.quote.total : undefined;
    return typeof total === "number" && Number.isFinite(total) ? { kind: "price_changed", total } : SOMETHING_WENT_WRONG;
  }
  if (status === 409 && b.error === "unavailable") {
    const roomIds = Array.isArray(b.roomIds) ? b.roomIds.filter((id): id is string => typeof id === "string") : [];
    return {
      kind: "unavailable",
      roomIds,
      message: roomIds.length > 0 ? "Sorry, that room was just booked." : "Sorry, those rooms are no longer available.",
    };
  }
  if (status === 409 && b.error === "not_ready") {
    // The same words as the checkout page's config_error.
    return { kind: "error", message: "This property can't take bookings right now." };
  }
  return SOMETHING_WENT_WRONG;
}
