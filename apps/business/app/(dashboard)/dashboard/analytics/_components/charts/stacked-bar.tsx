import { formatPercent } from "@/lib/analytics/format";
import type { Share } from "@/lib/analytics/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

interface StackedBarProps {
  rows: Share[];
  format: (value: number) => string;
  summary: string;
}

/** Parts of a whole as one horizontal bar. The legend carries the numbers. */
export function StackedBar({ rows, format, summary }: StackedBarProps) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm" role="img" aria-label={summary}>
        {rows.map((row, index) => (
          <div
            key={row.key}
            style={{ width: `${row.sharePct}%`, backgroundColor: COLORS[index % COLORS.length] }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
              aria-hidden
            />
            {row.label}
            <span className="tabular-nums">{format(row.value)}</span>
            <span className="text-muted-foreground tabular-nums">{formatPercent(row.sharePct, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
