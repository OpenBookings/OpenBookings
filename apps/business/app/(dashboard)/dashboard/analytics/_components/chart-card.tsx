"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { declinedMessage, isEmptySample } from "@/lib/analytics/chart-data";
import type { Basis, Widget } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { useEmpty } from "./empty-context";

const BASIS_LABELS: Record<Basis, string> = {
  booking: "By booking date",
  stay: "By stay date",
};

interface ChartCardProps<T> {
  title: string;
  /** What the figures are counted in: "EUR", "%", "Bookings". */
  unit: string;
  basis: Basis;
  periodLabel: string;
  widget: Widget<T>;
  /** Shown when the widget rendered over an empty sample. */
  emptyMessage?: string;
  /** Overrides the unit in the "needs at least" message. */
  sampleUnit?: string;
  /** A control in the header, e.g. a dimension toggle. */
  action?: ReactNode;
  className?: string;
  children: (value: T) => ReactNode;
}

/**
 * One chart or table, with its title, unit, date basis and period in the
 * header, and the three ways a widget declines to draw itself. On an empty page
 * the card keeps its place and its header, so the page has the same shape empty
 * as filled; the reason is given once, above the grid.
 */
export function ChartCard<T>({
  title,
  unit,
  basis,
  periodLabel,
  widget,
  emptyMessage = "No bookings in this period. Try a longer period.",
  sampleUnit,
  action,
  className,
  children,
}: ChartCardProps<T>) {
  const empty = useEmpty();
  // Before the first booking: an empty plot with its zero line. In an empty period: a word.
  const neverBooked = empty !== null && empty.variant !== "filtered";
  const emptyPeriod = empty?.variant === "filtered" && isEmptySample(widget);

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle className="font-medium text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">
            {[unit, BASIS_LABELS[basis], periodLabel].filter(Boolean).join(" · ")}
          </CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {neverBooked ? (
          <div className="h-40 border-b border-l" />
        ) : emptyPeriod ? (
          <p className="flex h-40 items-center justify-center rounded-md bg-muted/40 px-4 text-center text-muted-foreground text-sm">
            Nothing in this period
          </p>
        ) : isEmptySample(widget) ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : !widget.ok ? (
          <p className="text-muted-foreground text-sm">{declinedMessage(widget, sampleUnit)}</p>
        ) : (
          children(widget.value)
        )}
      </CardContent>
    </Card>
  );
}

export const WIDE = "@4xl/main:col-span-2";

/**
 * One or two columns of content-driven rows. Add `WIDE` to span both. On an
 * empty period the message comes first and the cards follow.
 */
export function WidgetGrid({ children }: { children: ReactNode }) {
  const empty = useEmpty();
  return (
    <div className="grid items-start gap-4 px-4 lg:px-6 @4xl/main:grid-cols-2">
      {empty?.panel ? <div className={cn("min-w-0", WIDE)}>{empty.panel}</div> : null}
      {children}
    </div>
  );
}
