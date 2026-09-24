import type { CellRun, RateCell, RoomTypeRow } from "./types";

/**
 * Collapse consecutive unsellable cells into spanning runs.
 *
 * The split is sellable versus not, rather than open versus not. A sellable
 * cell — open, or restricted but still bookable — carries a price, and a price
 * belongs to one night: merging three of them into a bar would replace three
 * numbers with a word. Its restriction shows as a chip under the price
 * instead.
 *
 * Unsellable cells have no number to lose, so they merge — but only when they
 * show the same reason *and* it comes from the same rule row. Two adjacent
 * closures from different rows are two decisions the host made on two
 * occasions, and one bar would misreport the date range in the detail panel.
 *
 * Derived reasons have no rule behind them, so consecutive sold-out dates
 * merge into one bar — which is right, since there is one fact to report.
 */
export function buildRuns(cells: RateCell[]): CellRun[] {
  const runs: CellRun[] = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    // Anything still sellable stays one column wide. A restricted date has a
    // price, and a price is per night — merging three of them into one bar
    // would replace three numbers with a word.
    if (cell.bookable) {
      runs.push({
        state: cell.state,
        startIndex: i,
        endIndex: i + 1,
        cells: [cell],
      });
      continue;
    }

    let end = i + 1;
    while (
      end < cells.length &&
      cells[end].primary === cell.primary &&
      barIdentity(cells[end]) === barIdentity(cell)
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

/**
 * What makes two adjacent cells the same bar: the rule the primary reason came
 * from. Null for derived reasons, which have no row behind them.
 */
function barIdentity(cell: RateCell): string | null {
  return cell.reasons[0]?.ruleId ?? null;
}

/**
 * Collapse a set of dates into the fewest inclusive ranges that cover them.
 *
 * The grid stages edits one cell at a time, but every table these edits land
 * in is range-based (`rate_overrides`, `rate_plan_restrictions`,
 * `room_closures`). Writing a row per date would work and would also be a lie
 * about what the host did: a week closed in one gesture is one decision, and
 * the detail panel reports the rule's range back to them. Seven rows would
 * report it as seven.
 *
 * Input order does not matter; duplicates collapse.
 */
export function groupConsecutiveDates(
  dates: Iterable<string>,
): { start: string; end: string }[] {
  const sorted = [...new Set(dates)].sort();
  const ranges: { start: string; end: string }[] = [];

  for (const date of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && nextDay(last.end) === date) {
      last.end = date;
      continue;
    }
    ranges.push({ start: date, end: date });
  }

  return ranges;
}

/** Date-only strings, stepped in UTC so a DST boundary cannot skip a day. */
function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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
