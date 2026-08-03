import type { CellRun, RateCell, RoomTypeRow } from "./types";

/**
 * Collapse consecutive same-state cells into spanning runs.
 *
 * Open cells stay one-per-column — each carries its own price, so merging them
 * would destroy the number. Non-open cells merge only when they are the same
 * state *and* the same underlying rule: two adjacent closures from different
 * rows are two separate decisions the host made, and drawing them as one bar
 * would misreport the date range in the detail panel.
 */
export function buildRuns(cells: RateCell[]): CellRun[] {
  const runs: CellRun[] = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    if (cell.state === "open") {
      runs.push({
        state: "open",
        startIndex: i,
        endIndex: i + 1,
        cells: [cell],
      });
      continue;
    }

    let end = i + 1;
    while (
      end < cells.length &&
      cells[end].state === cell.state &&
      cells[end].rule?.id === cell.rule?.id
    ) {
      end++;
    }

    runs.push({
      state: cell.state,
      startIndex: i,
      endIndex: end,
      cells: cells.slice(i, end),
    });
    i = end - 1;
  }

  return runs;
}

/** Short label for a restricted cell, e.g. "Min 3 nt" or "No arrival". */
export function restrictionLabel(cell: RateCell): string {
  const parts: string[] = [];
  if (cell.rule?.minStay != null && cell.rule.minStay > 1) {
    parts.push(`Min ${cell.rule.minStay} nt`);
  }
  if (cell.rule?.maxStay != null) parts.push(`Max ${cell.rule.maxStay} nt`);
  if (cell.closedToArrival) parts.push("No arrival");
  if (cell.closedToDeparture) parts.push("No departure");
  return parts.join(" · ") || "Restricted";
}

/** "2/4 plans open" — the collapsed group's at-a-glance summary. */
export function openPlanSummary(room: RoomTypeRow): string {
  const total = room.ratePlans.length;
  if (total === 0) return "No rate plans";
  const open = room.ratePlans.filter((p) => p.status !== "inactive").length;
  return `${open}/${total} plans open`;
}

/** True when any visible cell on the room type needs the host's attention. */
export function roomHasIssues(room: RoomTypeRow): boolean {
  if (room.availability.some((a) => a.effective <= 0)) return true;
  return room.ratePlans.some((plan) =>
    plan.cells.some((cell) => cell.state !== "open"),
  );
}
