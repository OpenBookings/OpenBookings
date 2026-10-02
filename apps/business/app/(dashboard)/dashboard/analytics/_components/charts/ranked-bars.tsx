import { formatPercent } from "@/lib/analytics/format";
import type { Share } from "@/lib/analytics/types";

/**
 * Ranked categories with value and share. With one or two rows there is
 * nothing to rank, so it is two lines of text and no bars.
 */
export function RankedBars({ rows, format }: { rows: Share[]; format: (value: number) => string }) {
  const figure = (row: Share) => (
    <span className="shrink-0 tabular-nums">
      {format(row.value)}
      <span className="ml-2 text-muted-foreground">{formatPercent(row.sharePct, 0)}</span>
    </span>
  );

  if (rows.length <= 2) {
    return (
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-4">
            <span className="truncate">{row.label}</span>
            {figure(row)}
          </li>
        ))}
      </ul>
    );
  }

  const peak = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate">{row.label}</span>
            {figure(row)}
          </div>
          {/* The figure beside it is the accessible value; the bar is shape. */}
          <div className="mt-1 h-1.5 rounded-sm bg-muted" aria-hidden>
            <div
              className="h-full rounded-sm bg-(--chart-1)"
              style={{ width: `${(row.value / peak) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
