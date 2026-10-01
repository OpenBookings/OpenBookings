import type { Point } from "./types";

/** Below this a time series is a table: a chart with two points is a sentence. */
export const MIN_CHART_POINTS = 7;

export interface LineRow {
  label: string;
  solid: number | null;
  dashed: number | null;
  compare: number | null;
}

/**
 * Splits one series into a solid and a dashed line. The dashed line starts at
 * the last complete point so the two meet, and covers every incomplete bucket.
 */
export function lineRows(points: Point[]): LineRow[] {
  const firstIncomplete = points.findIndex((p) => p.incomplete);
  return points.map((p, index) => ({
    label: p.label,
    solid: firstIncomplete === -1 || index < firstIncomplete ? p.value : null,
    dashed: firstIncomplete !== -1 && index >= firstIncomplete - 1 ? p.value : null,
    compare: p.compare,
  }));
}
