"use client";

import { GetHelpButton } from "@/components/support/get-help-button";
import { isUuid, shortBookingRef } from "@/lib/support/references";
import { MessageSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { HostReservation } from "@/lib/reservations/shape";

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const currencyFormatter = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
});

const utcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

function nightCount(reservation: HostReservation): number {
  const nights = (utcDate(reservation.checkOutDate).getTime() - utcDate(reservation.checkInDate).getTime()) / 86_400_000;
  return Math.max(1, Math.round(nights));
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-foreground mb-4 border-b pb-2 text-xs font-semibold uppercase tracking-wide">
        {title}
      </span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function ReservationDetailBody({
  reservation,
}: {
  reservation: HostReservation;
}) {
  const nights = nightCount(reservation);
  return (
    <div className="flex flex-col gap-8">
      <DetailSection title="Guest">
        <DetailField label="Name" value={reservation.guestName} />
        {reservation.guestPhone ? (
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground text-sm">Phone</span>
            <a href={`tel:${reservation.guestPhone.replace(/[^\d+]/g, "")}`} className="text-right text-sm font-medium underline-offset-2 hover:underline">
              {reservation.guestPhone}
            </a>
          </div>
        ) : null}
        {reservation.guestAddress ? (
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground text-sm">Address</span>
            <address className="text-right text-sm font-medium not-italic">
              {reservation.guestAddress.map((line) => (
                <span key={line} className="block">{line}</span>
              ))}
            </address>
          </div>
        ) : null}
        <DetailField
          label="Party size"
          value={`${reservation.guests} ${reservation.guests === 1 ? "guest" : "guests"}`}
        />
      </DetailSection>
      <DetailSection title="Stay">
        <DetailField
          label="Check-in"
          value={fullDateFormatter.format(utcDate(reservation.checkInDate))}
        />
        <DetailField
          label="Check-out"
          value={fullDateFormatter.format(utcDate(reservation.checkOutDate))}
        />
        <DetailField
          label="Nights"
          value={`${nights} ${nights === 1 ? "night" : "nights"}`}
        />
        {reservation.departedEarlyOn && (
          <DetailField
            label="Left early after"
            value={fullDateFormatter.format(utcDate(reservation.departedEarlyOn))}
          />
        )}
      </DetailSection>
      <DetailSection title="Rooms & cancellation">
        {reservation.rooms.map((room) => (
          <div key={room.reservationId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className={room.cancelledAt ? "text-muted-foreground text-sm line-through" : "text-sm font-medium"}>
                {room.roomName}
              </span>
              <span className="text-muted-foreground text-xs">
                {room.cancelledAt ? "Cancelled" : room.tierLabel}
              </span>
            </div>
            {!room.cancelledAt && (
              <ul className="text-muted-foreground list-disc pl-4 text-xs">
                {room.policyLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </DetailSection>
      <DetailSection title="Payment">
        {reservation.rooms.map((room) => (
          <DetailField key={room.reservationId} label={room.roomName} value={currencyFormatter.format(room.paid)} />
        ))}
        <Separator />
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-semibold">Total paid</span>
          <span className="text-sm font-semibold tabular-nums">
            {currencyFormatter.format(reservation.totalAmount)}
          </span>
        </div>
        {reservation.refundedAmount > 0 && (
          <DetailField label="Refunded" value={`− ${currencyFormatter.format(reservation.refundedAmount)}`} />
        )}
        {reservation.refundIssue && (
          <p className="text-destructive text-xs">
            A refund hasn&apos;t gone through yet. Use Retry refund below.
          </p>
        )}
      </DetailSection>
    </div>
  );
}

function QuickAction({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={label}
          className={className}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ReservationQuickActions({ reservationId }: { reservationId?: string }) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {/* Links the booking (a UUID) so support sees which one. Hidden while support is off. */}
        <GetHelpButton
          category="bookings"
          iconOnly
          size="icon"
          label="Get help with this booking"
          linked={
            isUuid(reservationId)
              ? { type: "booking", id: reservationId, label: `Booking ${shortBookingRef(reservationId)}`, detail: "" }
              : null
          }
        />
        <QuickAction label="Edit details">
          <Pencil />
        </QuickAction>
        <QuickAction label="Message">
          <MessageSquare />
        </QuickAction>
      </div>
    </TooltipProvider>
  );
}

export function ReservationDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[2, 4, 3].map((rows, section) => (
        <div key={section} className="flex flex-col">
          <div className="mb-4 border-b pb-2">
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: rows }).map((_, row) => (
              <div key={row} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
