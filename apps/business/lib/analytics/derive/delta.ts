import type { Delta } from "../types";

const NO_COMPARISON: Omit<Delta, "goodDirection"> = {
  pct: null,
  direction: "flat",
  label: "—",
};

/**
 * `goodDirection` travels with the delta rather than being decided at render,
 * so Cancellations and Average discount cannot be coloured green for rising by
 * a component that forgot they are the two that invert.
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  goodDirection: "up" | "down" = "up",
): Delta {
  if (current === null || previous === null || previous === 0) {
    return { ...NO_COMPARISON, goodDirection };
  }

  const pctRaw = ((current - previous) / Math.abs(previous)) * 100;
  const magnitude = Math.abs(pctRaw);
  const rounded = magnitude < 10 ? Math.round(pctRaw * 10) / 10 : Math.round(pctRaw);
  const shown = Math.abs(rounded);

  if (rounded === 0) {
    return { pct: 0, direction: "flat", label: "no change", goodDirection };
  }

  const direction = rounded > 0 ? "up" : "down";
  return { pct: rounded, direction, label: `${direction} ${shown}%`, goodDirection };
}
