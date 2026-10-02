"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lineRows, MIN_CHART_POINTS, tooltipLine } from "@/lib/analytics/chart-data";
import { EM_DASH, trendSentence } from "@/lib/analytics/format";
import type { Point } from "@/lib/analytics/types";

interface TimeLineProps {
  points: Point[];
  /** Names the measure in the tooltip and the accessible summary. */
  label: string;
  /** Names the comparison line, e.g. "Previous period". */
  compareLabel: string;
  format: (value: number) => string;
}

/**
 * Straight segments, a whole-unit axis, an optional comparison line, and a
 * dashed tail over any bucket that is not finished. Under seven points it is
 * a table: a line through three points claims a trend that is not there.
 */
export function TimeLine({ points, label, compareLabel, format }: TimeLineProps) {
  const hasCompare = points.some((p) => p.compare !== null);
  const show = (value: number | null) => (value === null ? EM_DASH : format(value));

  if (points.length < MIN_CHART_POINTS) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">{label}</TableHead>
            {hasCompare ? <TableHead className="text-right">{compareLabel}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.bucket}>
              <TableCell>
                {p.label}
                {p.incomplete ? <span className="text-muted-foreground"> (partial)</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{show(p.value)}</TableCell>
              {hasCompare ? <TableCell className="text-right tabular-nums">{show(p.compare)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const hasIncomplete = points.some((p) => p.incomplete);
  const labels = { solid: label, dashed: `${label}, not finished`, compare: compareLabel };

  return (
    <div>
      <ChartContainer
        config={{
          solid: { label: labels.solid, color: "var(--chart-1)" },
          dashed: { label: labels.dashed, color: "var(--chart-1)" },
          compare: { label: labels.compare, color: "var(--muted-foreground)" },
        }}
        className="h-64 w-full"
        role="img"
        // Built from this chart's own numbers, so it cannot go stale when the period changes.
        aria-label={trendSentence(label, points, format)}
      >
        <LineChart data={lineRows(points)} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={72}
            tickFormatter={(value: number) => format(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelKey="label"
                formatter={(value, name, item) =>
                  tooltipLine(String(name), Number(value), item.payload, labels, format)
                }
              />
            }
          />
          {hasCompare ? (
            <Line
              dataKey="compare"
              type="linear"
              stroke="var(--color-compare)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Line dataKey="solid" type="linear" stroke="var(--color-solid)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line
            dataKey="dashed"
            type="linear"
            stroke="var(--color-dashed)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      {hasIncomplete || hasCompare ? (
        <p className="mt-2 text-muted-foreground text-xs">
          {[
            hasCompare ? `Grey line: ${compareLabel.toLowerCase()}.` : null,
            hasIncomplete ? "Dashed: a partial week or month." : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
