"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MIN_BOOKINGS_FOR_DETAIL, type Widget } from "@/lib/analytics/types";

interface WidgetFrameProps<T> {
  title: string;
  /** The widget's definition, shown on the info affordance. */
  definition?: string;
  widget: Widget<T>;
  /** When set, the widget refuses to render below five bookings. */
  bookingsInPeriod?: number;
  requiresDetail?: boolean;
  /** True when the period holds no stays at all. */
  isEmpty?: boolean;
  className?: string;
  children: (value: T) => React.ReactNode;
}

/**
 * Every widget's outer shell: the card, the definition tooltip, and the three
 * ways a widget can decline to draw itself. Retry is router.refresh() — the
 * data comes from a server component, so re-rendering the route IS the retry.
 */
export function WidgetFrame<T>({
  title,
  definition,
  widget,
  bookingsInPeriod,
  requiresDetail = false,
  isEmpty = false,
  className,
  children,
}: WidgetFrameProps<T>) {
  const router = useRouter();
  const [retrying, startRetry] = React.useTransition();

  const tooThin =
    requiresDetail &&
    bookingsInPeriod !== undefined &&
    bookingsInPeriod < MIN_BOOKINGS_FOR_DETAIL;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 font-medium text-sm">
          {title}
          {definition ? (
            <Tooltip>
              <TooltipTrigger
                // Focusable in visual order, so the definition is reachable
                // without a mouse.
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
                aria-label={`What ${title} means`}
              >
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{definition}</TooltipContent>
            </Tooltip>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!widget.ok ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
              {widget.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => startRetry(() => router.refresh())}
            >
              <RotateCw className={retrying ? "animate-spin" : undefined} aria-hidden />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : tooThin ? (
          <CardDescription>
            Not enough bookings in this period to show this.
          </CardDescription>
        ) : isEmpty ? (
          <CardDescription>No stays in this period.</CardDescription>
        ) : (
          children(widget.value)
        )}
      </CardContent>
    </Card>
  );
}
