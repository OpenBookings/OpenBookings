import type {
  CellState,
  RateCell,
  RatePlanStatus,
  Reason,
  ReasonCode,
  ReasonSource,
  RestrictionRule,
  RoomClosureRule,
  RoomTypeRow,
} from "./types";

/**
 * Cell-state derivation, kept out of the query layer so the demo dataset can
 * run the exact same rules. If these lived inside `loadAriGrid`, the mock
 * would have to reimplement them and would drift the first time precedence
 * changed.
 */

/** The state each reason code paints the cell. */
const STATE_BY_CODE: Record<ReasonCode, Exclude<CellState, "open">> = {
  ROOM_CLOSED: "room_closed",
  SOLD_OUT: "sold_out",
  STOP_SELL: "closed",
  CLOSED_TO_ARRIVAL: "restricted",
  CLOSED_TO_DEPARTURE: "restricted",
  MIN_STAY: "restricted",
  MAX_STAY: "restricted",
};

/** Codes that stop a booking outright. The rest constrain one that can still happen. */
const UNBOOKABLE = new Set<ReasonCode>(["ROOM_CLOSED", "SOLD_OUT", "STOP_SELL"]);

function hostSource(rule: {
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  note: string | null;
}): ReasonSource {
  return {
    kind: "host",
    userId: rule.createdBy,
    userName: rule.createdByName,
    at: rule.createdAt,
    note: rule.note,
  };
}

export interface StatusInput {
  /** Effective room-type availability for the date. */
  available: number;
  /** room_closures row covering the date, if any. Cascades to every plan. */
  roomClosure: RoomClosureRule | null;
  /** rate_plan_restrictions row with is_closed set. */
  closure: RestrictionRule | null;
  /** rate_plan_restrictions row carrying stay rules. */
  restriction: RestrictionRule | null;
  /** The restriction's min stay where it sets one, else the plan default. */
  effectiveMinStay: number;
  planMinStay: number;
}

export interface ResolvedStatus {
  /** First match in the precedence order — what the cell is painted as. */
  primary: ReasonCode | null;
  /** Every reason that applies, in that same order. */
  reasons: Reason[];
  bookable: boolean;
  state: CellState;
}

/**
 * Resolve one cell's status: which reasons apply, and which of them the host
 * sees first.
 *
 * The order is the contract, and it is ordered by what a host can act on:
 *
 * 1. `ROOM_CLOSED` — the room type is shut, so nothing under it is sellable
 *    and every plan-level rule is moot until it reopens.
 * 2. `SOLD_OUT` — a room-type fact that cascades the same way. A host looking
 *    at a full house needs "we're full" rather than whatever the plan happens
 *    to say, and it outranks a plan closure because reopening the plan would
 *    not sell a single room.
 * 3. `STOP_SELL` — one plan closed deliberately.
 * 4. `CLOSED_TO_ARRIVAL` / `CLOSED_TO_DEPARTURE`, then `MIN_STAY` / `MAX_STAY`
 *    — still bookable, just constrained.
 *
 * Every matching reason is collected regardless of which one wins. A date that
 * is sold out *and* min-stay constrained keeps both, so lifting the closure
 * cannot surprise a host with a rule nobody told them about.
 */
export function resolveStatus(input: StatusInput): ResolvedStatus {
  const {
    available,
    roomClosure,
    closure,
    restriction,
    effectiveMinStay,
    planMinStay,
  } = input;

  const reasons: Reason[] = [];

  if (roomClosure) {
    reasons.push({
      code: "ROOM_CLOSED",
      source: hostSource(roomClosure),
      inherited: true,
      range: { start: roomClosure.startDate, end: roomClosure.endDate },
      ruleId: roomClosure.id,
    });
  }

  if (available <= 0) {
    // Nobody decided this; it fell out of the bookings. No rule, no author.
    reasons.push({
      code: "SOLD_OUT",
      source: { kind: "system" },
      inherited: true,
      range: null,
      ruleId: null,
    });
  }

  if (closure) {
    reasons.push({
      code: "STOP_SELL",
      source: hostSource(closure),
      inherited: false,
      range: { start: closure.startDate, end: closure.endDate },
      ruleId: closure.id,
    });
  }

  if (restriction) {
    const range = { start: restriction.startDate, end: restriction.endDate };
    const source = hostSource(restriction);

    if (restriction.closedToArrival) {
      reasons.push({
        code: "CLOSED_TO_ARRIVAL",
        source,
        inherited: false,
        range,
        ruleId: restriction.id,
      });
    }
    if (restriction.closedToDeparture) {
      reasons.push({
        code: "CLOSED_TO_DEPARTURE",
        source,
        inherited: false,
        range,
        ruleId: restriction.id,
      });
    }
    // Only a min stay *above* the plan's own default is news. A restriction
    // row repeating the default constrains nothing and earns no chip.
    if (effectiveMinStay > planMinStay) {
      reasons.push({
        code: "MIN_STAY",
        source,
        value: effectiveMinStay,
        inherited: false,
        range,
        ruleId: restriction.id,
      });
    }
    if (restriction.maxStay !== null) {
      reasons.push({
        code: "MAX_STAY",
        source,
        value: restriction.maxStay,
        inherited: false,
        range,
        ruleId: restriction.id,
      });
    }
  }

  const primary = reasons[0]?.code ?? null;

  return {
    primary,
    reasons,
    bookable: !reasons.some((r) => UNBOOKABLE.has(r.code)),
    state: primary ? STATE_BY_CODE[primary] : "open",
  };
}

/**
 * Cell state alone, for callers that do not need the reasons.
 *
 * Kept as a thin wrapper rather than a second implementation: two functions
 * deciding the same precedence is how a grid ends up painting one thing and
 * explaining another.
 */
export function deriveState(input: StatusInput): CellState {
  return resolveStatus(input).state;
}

/**
 * Status dot thresholds, stated explicitly so the dot means the same thing on
 * every row: every visible date open is healthy; every visible date closed or
 * sold out is inactive; anything in between wants a look.
 */
export function deriveStatus(cells: RateCell[]): RatePlanStatus {
  if (cells.length === 0) return "inactive";
  const unsellable = cells.filter((c) => !c.bookable).length;
  if (unsellable === cells.length) return "inactive";
  if (cells.every((c) => c.state === "open")) return "healthy";
  return "attention";
}

/** How full a room type is on one date. Drives the availability bar's colour. */
export type AvailabilityLevel = "sold_out" | "low" | "ok";

/**
 * A "low" state is only meaningful once there is enough stock for low to mean
 * something.
 *
 * Under three units, a quarter of the total rounds to a number that is true on
 * almost every open date — a one-unit room type would read as low from the
 * moment it had anything to sell, which is every date it is not sold out. That
 * is not a warning, it is a permanent colour, and a permanent colour is
 * ignored. So: no low state below three units, and above it, a quarter of the
 * total or one unit, whichever is larger.
 */
export function availabilityLevel(
  available: number,
  total: number,
): AvailabilityLevel {
  if (available <= 0) return "sold_out";
  if (total < 3) return "ok";
  return available <= Math.max(1, Math.round(total * 0.25)) ? "low" : "ok";
}

/**
 * Fill each room's collapsed-row summary with the cheapest bookable rate per
 * date. Null stays null when nothing is sellable — the grid renders that as
 * "N/A" rather than implying a price exists.
 */
export function applyLowestRates(
  rooms: Iterable<RoomTypeRow>,
  dateIndex: Map<string, number>,
): void {
  for (const room of rooms) {
    for (const plan of room.ratePlans) {
      for (const cell of plan.cells) {
        if (cell.price === null) continue;
        const index = dateIndex.get(cell.date);
        if (index === undefined) continue;
        const current = room.lowestRates[index];
        if (current === null || cell.price < current) {
          room.lowestRates[index] = cell.price;
        }
      }
    }
  }
}
