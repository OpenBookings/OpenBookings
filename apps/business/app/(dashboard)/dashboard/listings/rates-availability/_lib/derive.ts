import type {
  CellState,
  RateCell,
  RatePlanStatus,
  RestrictionRule,
  RoomTypeRow,
} from "./types";

/**
 * Cell-state derivation, kept out of the query layer so the demo dataset can
 * run the exact same rules. If these lived inside `loadAriGrid`, the mock
 * would have to reimplement them and would drift the first time precedence
 * changed.
 */

/**
 * Cell state precedence. Sold out first: it is a room-type fact that cascades
 * to every plan on the room, and a host looking at a full house needs to see
 * "we're full" rather than whatever the plan-level rule happens to say. Then
 * closed, which the host set deliberately. Restricted last — still bookable.
 */
export function deriveState(
  available: number,
  closure: RestrictionRule | null,
  restriction: RestrictionRule | null,
  effectiveMinStay: number,
  planMinStay: number,
): CellState {
  if (available <= 0) return "sold_out";
  if (closure) return "closed";
  if (!restriction) return "open";
  if (
    restriction.closedToArrival ||
    restriction.closedToDeparture ||
    effectiveMinStay > planMinStay ||
    restriction.maxStay !== null
  ) {
    return "restricted";
  }
  return "open";
}

/**
 * Status dot thresholds, stated explicitly so the dot means the same thing on
 * every row: every visible date open is healthy; every visible date closed or
 * sold out is inactive; anything in between wants a look.
 */
export function deriveStatus(cells: RateCell[]): RatePlanStatus {
  if (cells.length === 0) return "inactive";
  const unsellable = cells.filter(
    (c) => c.state === "closed" || c.state === "sold_out",
  ).length;
  if (unsellable === cells.length) return "inactive";
  if (cells.every((c) => c.state === "open")) return "healthy";
  return "attention";
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
