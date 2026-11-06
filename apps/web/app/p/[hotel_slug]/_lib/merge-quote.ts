import type { StayQuote } from "@/lib/booking/quote";
import type { DbRoom } from "../_components/constants";

/** One rate's price for the stay in the URL, in euros, tourist tax included in `total`. */
export type PricedRate = {
  ratePlanId: string;
  stayTotal: number;
  touristTax: number;
  total: number;
  perNight: number;
  freeCancellationUntil: string | null;
  /** Non-refundable only: how much less a night costs than the cheapest refundable rate shown. */
  saving: number;
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
  leftCaption: string | null;
  rates: Record<string, PricedRate | null>;
};

export type QuoteState = { status: "none" } | { status: "loading" } | { status: "error" } | { status: "ready"; quote: StayQuote };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Only the last rooms are counted out loud, never the host's total. */
function leftCaption(unitsLeft: number): string | null {
  return unitsLeft === 1 || unitsLeft === 2 ? `${unitsLeft} left` : null;
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
      leftCaption: null,
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
        const total = round2(qp.stayTotal + qp.touristTax.total);
        rates[plan.id] = {
          ratePlanId: plan.id,
          stayTotal: qp.stayTotal,
          touristTax: qp.touristTax.total,
          total,
          perNight: round2(total / nights),
          freeCancellationUntil: qp.freeCancellationUntil,
          saving: 0,
        };
      }
      // Same comparison as the listing (withCancellationTerms), on the stay's prices.
      const refundable = room.rate_plans.filter((p) => p.is_refundable && rates[p.id]).map((p) => rates[p.id].perNight);
      if (refundable.length > 0) {
        const cheapest = Math.min(...refundable);
        for (const plan of room.rate_plans) {
          const r = rates[plan.id];
          if (r && !plan.is_refundable) r.saving = Math.max(0, round2(cheapest - r.perNight));
        }
      }
    }
    const unitsLeft = q?.unitsLeft ?? 0;
    return {
      roomId: room.id,
      visible: Object.keys(rates).length > 0,
      unitsLeft,
      leftCaption: leftCaption(unitsLeft),
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
