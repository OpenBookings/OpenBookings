import type { Delta } from "../types";

/**
 * Null whenever there is nothing honest to show: no comparison, a comparison
 * of zero, or a change that rounds to zero. The UI renders a chip only for a
 * non-null delta, so "up 0%" cannot appear.
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  tone: Delta["tone"] = "directional",
): Delta | null {
  if (current === null || previous === null || previous === 0) return null;
  const raw = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.abs(raw) < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  if (rounded === 0) return null;
  const direction = rounded > 0 ? "up" : "down";
  return { pct: rounded, direction, label: `${direction} ${Math.abs(rounded)}%`, tone };
}
