"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCount } from "@/lib/analytics/format";
import type { UpcomingWindow } from "@/lib/analytics/types";

const config = {
  nightsSold: { label: "Nights sold", color: "var(--chart-1)" },
  nightsAvailable: { label: "Still available", color: "var(--chart-3)" },
};

/**
 * Sold against still-available, per window. Stacking these two is only honest
 * because they add up to the inventory in the window — which is why the
 * derivation subtracts sold from the total rather than reporting both.
 */
export function UpcomingStackedBar({ windows }: { windows: UpcomingWindow[] }) {
  if (windows.every((w) => w.nightsSold + w.nightsAvailable === 0)) {
    return <p className="text-muted-foreground text-sm">No rooms open in the next 90 days.</p>;
  }

  const summary = windows
    .map(
      (w) =>
        `${w.label}: ${formatCount(w.nightsSold)} of ${formatCount(
          w.nightsSold + w.nightsAvailable,
        )} nights sold`,
    )
    .join("; ");

  return (
    <ChartContainer
      config={config}
      className="h-64 w-full"
      role="img"
      aria-label={`Upcoming sell-through. ${summary}.`}
    >
      <BarChart data={windows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={56} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="nightsSold" stackId="nights" fill="var(--color-nightsSold)" radius={[0, 0, 4, 4]} />
        <Bar dataKey="nightsAvailable" stackId="nights" fill="var(--color-nightsAvailable)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
