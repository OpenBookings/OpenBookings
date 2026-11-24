import type { AppliedDiscount } from "@openbookings/pricing";
import { roundHalfUp } from "@openbookings/pricing/money";
import type { StayQuote } from "@/lib/booking/quote";
import type { DbRoom } from "../_components/constants";

/** One rate's price for the stay in the URL, in cents, tourist tax included in `totalCents`. */
export type PricedRate = {
  ratePlanId: string;
  stayTotalCents: number;
  touristTaxCents: number;
  totalCents: number;
  perNightCents: number;
  freeCancellationUntil: string | null;
  /** Non-refundable only: how many cents less a night costs than the cheapest refundable rate shown. */
  savingCents: number;
  /** The stay discount already in the price ("Weekly discount", 10 %), or null. */
  discount: AppliedDiscount | null;
  /**
   * `totalCents` is for one room's largest share of the party. What one room
   * costs, in cents, for each other party it may be given, by `partyKey`; see
   * QuotedRatePlan.
   */
  partyTotals: Record<string, number>;
};

/**
 * How one of the page's rooms shows for the stay. `rates` holds the rates to
 * show: a rate left out is hidden, and `null` means shown at today's price
 * (no stay, or its quote has not arrived).
 */
export type RoomView = {
  roomId: string;
  visible: boolean;
  unitsLeft: number | null;
  /** The room panel's "Last room for your dates" pill, or null. */
  scarcity: Scarcity | null;
  /** Another guest is in checkout for this room on these dates. */
  othersBooking: boolean;
  /** How many one unit sleeps, from the quote; null without one. */
  maxAdults: number | null;
  maxChildren: number | null;
  rates: Record<string, PricedRate | null>;
};

export type QuoteState = { status: "none" } | { status: "loading" } | { status: "error" } | { status: "ready"; quote: StayQuote };

/**
 * How close a room is to selling out, louder as it runs out: 3 left is a
 * heads-up, 2 is "only", 1 is the last room. Only the last rooms are counted
 * out loud, never the host's total.
 */
export type Scarcity = { level: "few" | "low" | "last"; label: string };

function scarcityOf(unitsLeft: number): Scarcity | null {
  if (unitsLeft === 1) return { level: "last", label: "Last room for your dates" };
  if (unitsLeft === 2) return { level: "low", label: "Only 2 left for your dates" };
  if (unitsLeft === 3) return { level: "few", label: "3 left for your dates" };
  return null;
}

/**
 * The page's rooms with the stay's quote laid over them. A rate shows only if
 * the quote can book it; a room shows only if it can be booked and has a
 * rate that shows. Anything the quote does not mention is hidden too: the
 * page's own list may be older than the quote.
 */
export function mergeQuote(rooms: DbRoom[], state: QuoteState): RoomView[] {
  if (state.status !== "ready") {
    return rooms.map((room) => ({
      roomId: room.id,
      visible: true,
      unitsLeft: null,
      scarcity: null,
      othersBooking: false,
      maxAdults: null,
      maxChildren: null,
      rates: Object.fromEntries(room.rate_plans.map((plan) => [plan.id, null])),
    }));
  }

  const nights = Math.max(1, nightsOf(state.quote));
  const quoted = new Map(state.quote.rooms.map((r) => [r.roomId, r]));
  return rooms.map((room) => {
    const q = quoted.get(room.id);
    const rates: Record<string, PricedRate> = {};
    if (q && q.reasons.length === 0) {
      for (const plan of room.rate_plans) {
        const qp = q.ratePlans.find((p) => p.ratePlanId === plan.id);
        if (!qp || qp.reasons.length > 0) continue;
        rates[plan.id] = {
          ratePlanId: plan.id,
          stayTotalCents: qp.stayTotalCents,
          touristTaxCents: qp.touristTax.totalCents,
          totalCents: qp.totalCents,
          perNightCents: roundHalfUp(qp.totalCents / nights),
          freeCancellationUntil: qp.freeCancellationUntil,
          savingCents: 0,
          discount: qp.discount ?? null,
          partyTotals: qp.partyTotals ?? {},
        };
      }
      // Same comparison as the listing (withCancellationTerms), on the stay's prices.
      const refundable = room.rate_plans.filter((p) => p.is_refundable && rates[p.id]).map((p) => rates[p.id].perNightCents);
      if (refundable.length > 0) {
        const cheapest = Math.min(...refundable);
        for (const plan of room.rate_plans) {
          const r = rates[plan.id];
          if (r && !plan.is_refundable) r.savingCents = Math.max(0, cheapest - r.perNightCents);
        }
      }
    }
    const unitsLeft = q?.unitsLeft ?? 0;
    const visible = Object.keys(rates).length > 0;
    return {
      roomId: room.id,
      visible,
      unitsLeft,
      scarcity: visible ? scarcityOf(unitsLeft) : null,
      othersBooking: visible && (q?.heldByOthers ?? 0) > 0,
      maxAdults: q?.maxAdults ?? null,
      maxChildren: q?.maxChildren ?? null,
      rates,
    };
  });
}

function nightsOf(quote: StayQuote): number {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((day(quote.stay.checkOut) - day(quote.stay.checkIn)) / 86_400_000);
}

/**
 * The guest's picks that still fit the shown rooms: picks of a hidden rate
 * are dropped, and a room's picks (all its rates together) are capped at the
 * rooms left, earlier rates first. The same object comes back when nothing
 * changed, so it can be used in a state update.
 */
export function pruneQuantities(rooms: DbRoom[], views: RoomView[], quantities: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  let changed = false;
  rooms.forEach((room, i) => {
    const view = views[i];
    let left = view?.unitsLeft ?? Infinity;
    for (const plan of room.rate_plans) {
      const qty = quantities[plan.id] ?? 0;
      if (qty === 0) {
        if (plan.id in quantities) changed = true;
        continue;
      }
      const shown = Boolean(view?.visible) && plan.id in (view?.rates ?? {});
      const kept = shown ? Math.min(qty, left) : 0;
      left -= kept;
      if (kept !== qty) changed = true;
      if (kept > 0) next[plan.id] = kept;
    }
  });
  // Picks for rates the page does not list at all.
  const known = new Set(rooms.flatMap((r) => r.rate_plans.map((p) => p.id)));
  if (Object.keys(quantities).some((id) => !known.has(id))) changed = true;
  return changed ? next : quantities;
}
