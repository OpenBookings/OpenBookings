import { Progress } from "@/components/ui/progress";
import type { Category } from "@/lib/analytics/types";

interface RankedListProps {
  rows: Category[];
  /** Renders the primary figure — euros for modifiers, a count for countries. */
  format: (value: number) => string;
  /** Labels `count` when a row carries one, e.g. "applied 24 times". */
  countLabel?: (count: number) => string;
  emptyMessage?: string;
}

/**
 * Countries and modifiers: a name, an inline bar for shape, and the figure. The
 * bar is scaled to the largest absolute value so a negative revenue impact —
 * a discount — still draws a bar proportional to the money it moved.
 */
export function RankedList({
  rows,
  format,
  countLabel,
  emptyMessage = "No stays in this period.",
}: RankedListProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  const peak = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {format(row.value)}
              {row.count !== undefined && countLabel ? (
                <span className="ml-2 text-muted-foreground text-xs">
                  {countLabel(row.count)}
                </span>
              ) : null}
            </span>
          </div>
          <Progress
            value={(Math.abs(row.value) / peak) * 100}
            // The figure beside it is the accessible value; the bar is shape.
            aria-hidden
            className="h-1.5"
          />
        </li>
      ))}
    </ul>
  );
}
