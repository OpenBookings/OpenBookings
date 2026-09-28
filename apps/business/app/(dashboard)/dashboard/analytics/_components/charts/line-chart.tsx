"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { trendSentence } from "@/lib/analytics/format";
import type { Point } from "@/lib/analytics/types";

interface TrendLineChartProps {
  points: Point[];
  /** Names the measure in the tooltip and in the accessible summary. */
  label: string;
  format: (value: number) => string;
}

export function TrendLineChart({ points, label, format }: TrendLineChartProps) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-64 w-full"
      role="img"
      // Built from this chart's own numbers, so it cannot go stale when the
      // host changes the period.
      aria-label={trendSentence(label, points, format)}
    >
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
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
              // The exact value plus the date, as the spec requires.
              labelKey="label"
              formatter={(value) => format(Number(value))}
            />
          }
        />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

interface DualLineChartProps {
  series: { key: string; label: string; points: Point[] }[];
  format: (value: number) => string;
  summary: string;
}

/** Achieved price against base price: two series over the same buckets. */
export function DualLineChart({ series, format, summary }: DualLineChartProps) {
  if (series.every((s) => s.points.length === 0)) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  // Recharts wants one row per bucket with a column per series.
  const buckets = series[0]?.points ?? [];
  const data = buckets.map((point, index) => ({
    label: point.label,
    ...Object.fromEntries(series.map((s) => [s.key, s.points[index]?.value ?? 0])),
  }));

  const config = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${i + 1})` }]),
  );

  return (
    <ChartContainer config={config} className="h-64 w-full" role="img" aria-label={summary}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
          content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
