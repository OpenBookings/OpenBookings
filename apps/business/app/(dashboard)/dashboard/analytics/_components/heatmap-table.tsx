"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/analytics/format";
import type { Heatmap, HeatCell } from "@/lib/analytics/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Tint is redundant encoding, never the message: the percentage is printed in
 * every cell. Five steps rather than a continuous ramp, because a host reading a
 * grid is comparing bands, not interpolating opacity.
 */
function tintFor(pct: number | null): string {
  if (pct === null) return "bg-muted/40";
  if (pct >= 90) return "bg-(--chart-1)/80 text-background";
  if (pct >= 70) return "bg-(--chart-1)/60";
  if (pct >= 50) return "bg-(--chart-1)/40";
  if (pct >= 25) return "bg-(--chart-1)/20";
  return "bg-(--chart-1)/5";
}

function cellTooltip(cell: HeatCell, weekLabel: string): string {
  if (cell.nightsAvailable === 0) {
    return `${WEEKDAYS[cell.weekday - 1]}, week of ${weekLabel}: no rooms were open.`;
  }
  return `${WEEKDAYS[cell.weekday - 1]}, week of ${weekLabel}: ${cell.nightsSold} of ${cell.nightsAvailable} nights sold, ${formatPercent(cell.pct)} sell-through.`;
}

export function HeatmapTable({ heatmap }: { heatmap: Heatmap }) {
  if (heatmap.weeks.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  const byKey = new Map(heatmap.cells.map((cell) => [`${cell.weekStart}:${cell.weekday}`, cell]));

  return (
    // Fifty-two weeks on Last 12 months, so the table scrolls and the weekday
    // column stays put. That is the whole reason this is a Table.
    <div className="overflow-x-auto">
      <Table className="w-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Day</TableHead>
            {heatmap.weeks.map((week) => (
              <TableHead key={week.start} className="whitespace-nowrap text-center">
                {week.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {WEEKDAYS.map((weekday, index) => (
            <TableRow key={weekday}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {weekday}
              </TableCell>
              {heatmap.weeks.map((week) => {
                const cell = byKey.get(`${week.start}:${index + 1}`);
                if (!cell) return <TableCell key={week.start} />;
                return (
                  <TableCell key={week.start} className="p-1 text-center">
                    <Tooltip>
                      <TooltipTrigger
                        className={cn(
                          "w-full rounded-sm px-2 py-1.5 text-xs tabular-nums",
                          tintFor(cell.pct),
                        )}
                      >
                        {/* Printed, always. The tint alone would fail anyone who
                            cannot distinguish the steps. */}
                        {formatPercent(cell.pct, 0)}
                      </TooltipTrigger>
                      <TooltipContent>{cellTooltip(cell, week.label)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
