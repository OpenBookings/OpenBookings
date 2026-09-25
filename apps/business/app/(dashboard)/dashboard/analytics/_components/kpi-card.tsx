"use client";

import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Area, AreaChart } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { Delta, Point } from "@/lib/analytics/types";

/**
 * The arrow is never alone: `delta.label` is rendered as text beside it, so the
 * direction survives colour blindness, a greyscale print and a screen reader.
 * Whether up is good travels on the delta, because Cancellations and Average
 * discount are the two where it is not.
 */
export function DeltaBadge({ delta }: { delta: Delta }) {
  if (delta.pct === null) {
    return <span className="text-muted-foreground text-xs">No comparison data</span>;
  }

  const Icon =
    delta.direction === "up" ? ArrowUp : delta.direction === "down" ? ArrowDown : ArrowRight;
  const good =
    delta.direction === "flat" ? null : delta.direction === delta.goodDirection;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        good === null && "text-muted-foreground",
        good === true && "text-(--green-11)",
        good === false && "text-destructive",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {delta.label}
    </span>
  );
}

export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  if (points.length < 2) return null;
  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-10 w-full"
      // Decorative: the number above it carries the value, and the chart beside
      // it carries the shape. Announcing it again would only add noise.
      aria-hidden
    >
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          fill="var(--color-value)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function KpiValue({
  value,
  delta,
  spark,
  sparkLabel,
}: {
  value: string;
  delta?: Delta;
  spark?: Point[];
  sparkLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-semibold text-2xl tabular-nums tracking-tight">{value}</p>
      {delta ? <DeltaBadge delta={delta} /> : null}
      {spark && sparkLabel ? <Sparkline points={spark} label={sparkLabel} /> : null}
    </div>
  );
}
