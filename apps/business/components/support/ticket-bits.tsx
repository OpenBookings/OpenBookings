"use client";

import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { shortBookingRef } from "@/lib/support/references";
import { statusLabel, type TicketStatus } from "@/lib/support/status";

/** Status always carries its label: never colour alone. */
export function TicketStatusBadge({
  status,
  assistantEnabled,
  className,
}: {
  status: TicketStatus;
  assistantEnabled: boolean;
  className?: string;
}) {
  return (
    <Badge variant={status === "resolved" ? "outline" : "secondary"} className={cn("shrink-0", className)}>
      {statusLabel(status, assistantEnabled)}
    </Badge>
  );
}

export function UnreadDot({ unread, className }: { unread: boolean; className?: string }) {
  if (!unread) return <span aria-hidden className={cn("size-2 shrink-0", className)} />;
  return (
    <span className={cn("relative flex size-2 shrink-0", className)}>
      <span aria-hidden className="size-2 rounded-full bg-destructive" />
      <span className="sr-only">unread</span>
    </span>
  );
}

/**
 * The placeholder booking reference: `#0a1b2c3d`, with the full UUID right
 * under it (`stacked`) or on hover.
 */
export function BookingRef({ bookingId, stacked = false }: { bookingId: string; stacked?: boolean }) {
  if (stacked) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">Booking {shortBookingRef(bookingId)}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{bookingId}</span>
      </span>
    );
  }
  return (
    <span title={bookingId} className="font-medium">
      Booking {shortBookingRef(bookingId)}
    </span>
  );
}

/** Relative time with the full timestamp on hover. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  const full = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <time dateTime={iso} className={cn("cursor-default whitespace-nowrap tabular-nums", className)}>
          {formatRelativeTime(date)}
        </time>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto px-3 py-1.5 text-xs">{full}</HoverCardContent>
    </HoverCard>
  );
}
