"use client";

import { Bar as BarMark, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Bar } from "@/lib/analytics/types";

interface BarsProps {
  rows: Bar[];
  label: string;
  format: (value: number) => string;
  /** The accessible summary. Built by the caller, which knows what the bars mean. */
  summary: string;
}

/** Vertical bars over ordered buckets, in the order given. Never sorted. */
export function Bars({ rows, label, format, summary }: BarsProps) {
  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-56 w-full"
      role="img"
      aria-label={summary}
    >
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={48}
          allowDecimals={false}
          tickFormatter={(value: number) => format(value)}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
        />
        <BarMark dataKey="value" fill="var(--color-value)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
