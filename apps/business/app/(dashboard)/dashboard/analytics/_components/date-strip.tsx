import { formatDate, formatDayMonth } from "@/lib/analytics/format";
import type { DayCell } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

/**
 * The next ninety days, one cell per day: filled from the bottom by the share
 * sold. Friday and Saturday nights carry a dot, so an empty weekend is the
 * first thing the eye lands on. Thirty to a row on narrow screens, ninety on
 * wide ones. Each cell's detail is its native title: one tooltip, not ninety.
 */
export function DateStrip({ cells }: { cells: DayCell[] }) {
  const unsoldWeekendNights = cells
    .filter((cell) => cell.weekend)
    .reduce((total, cell) => total + Math.max(0, cell.available - cell.sold), 0);

  return (
    <div>
      <ol className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-x-px gap-y-2 @4xl/main:grid-cols-[repeat(90,minmax(0,1fr))]">
        {cells.map((cell) => {
          const share = cell.available === 0 ? 0 : Math.min(1, cell.sold / cell.available);
          return (
            <li
              key={cell.date}
              title={`${formatDate(cell.date)}: ${cell.sold} of ${cell.available} sold`}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "relative block h-10 w-full overflow-hidden rounded-[1px] bg-muted",
                  cell.available === 0 && "opacity-40",
                )}
              >
                <span
                  className="absolute inset-x-0 bottom-0 bg-(--chart-1)"
                  style={{ height: `${share * 100}%` }}
                />
              </span>
              <span
                className={cn("size-1 rounded-full", cell.weekend ? "bg-foreground" : "bg-transparent")}
                aria-hidden
              />
            </li>
          );
        })}
      </ol>
      <div className="mt-1 flex justify-between text-muted-foreground text-xs">
        <span>{formatDayMonth(cells[0].date)}</span>
        <span>{formatDayMonth(cells[cells.length - 1].date)}</span>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        Filled is sold, empty is still available. Dots mark Friday and Saturday nights:{" "}
        {unsoldWeekendNights} of those are still unsold.
      </p>
    </div>
  );
}
