import type { Point, Widget } from "./types";

/** Below this a time series is a table: a chart with two points is a sentence. */
export const MIN_CHART_POINTS = 7;

export interface LineRow {
  label: string;
  solid: number | null;
  dashed: number | null;
  compare: number | null;
}

/**
 * Splits one series into a solid and a dashed line. A point is solid when its
 * bucket is complete. The dashed line carries every incomplete point plus the
 * complete point beside it, so the two lines meet, at either end of the chart.
 */
export function lineRows(points: Point[]): LineRow[] {
  return points.map((p, index) => {
    const besidePartial = points[index - 1]?.incomplete || points[index + 1]?.incomplete;
    return {
      label: p.label,
      solid: p.incomplete ? null : p.value,
      dashed: p.incomplete || besidePartial ? p.value : null,
      compare: p.compare,
    };
  });
}

/**
 * One tooltip line: the series name beside its value. Where the solid and
 * dashed lines meet, both carry the same value; the dashed copy is dropped.
 */
export function tooltipLine(
  series: string,
  value: number,
  row: Pick<LineRow, "solid" | "dashed">,
  labels: Record<string, string>,
  format: (value: number) => string,
): string | null {
  if (series === "dashed" && row.solid !== null) return null;
  return `${labels[series] ?? series}: ${format(value)}`;
}

/** True when the period held nothing at all for this widget, minimum or no minimum. */
export function isEmptySample(widget: Widget<unknown>): boolean {
  if (widget.ok) return widget.sample === 0;
  return widget.reason === "below-minimum" && widget.have === 0;
}

/** What a widget says in place of itself when it declines to render. */
export function declinedMessage(
  widget: Exclude<Widget<unknown>, { ok: true }>,
  unit?: string,
): string {
  if (widget.reason === "error") return widget.message;
  const counted = unit ?? (widget.basis === "booking" ? "bookings" : "nights sold");
  return `Needs at least ${widget.needed} ${counted} (${widget.have} so far)`;
}
