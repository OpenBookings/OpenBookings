"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { Category } from "@/lib/analytics/types";

interface RankedBarChartProps {
  rows: Category[];
  label: string;
  format: (value: number) => string;
  /** The accessible summary. Built by the caller, which knows what the bars mean. */
  summary: string;
  /** Lead time keeps the spec's bucket order; everything else sorts descending. */
  sorted?: boolean;
  height?: string;
}

/**
 * Horizontal bars, which is what the spec asks for on every ranked chart — and
 * also what a lead-time histogram of pre-bucketed counts is. A separate
 * histogram component would be this code with a different name.
 */
export function RankedBarChart({
  rows,
  label,
  format,
  summary,
  sorted = true,
  height = "h-64",
}: RankedBarChartProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  const data = sorted ? [...rows].sort((a, b) => b.value - a.value) : rows;

  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className={`${height} w-full`}
      role="img"
      aria-label={summary}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={132}
          tickMargin={8}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
