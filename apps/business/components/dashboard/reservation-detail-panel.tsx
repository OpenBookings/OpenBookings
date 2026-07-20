"use client";

import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ReservationStatusBadge } from "@/components/dashboard/reservation-status";
import type { MockReservation } from "@/components/dashboard/mock-reservations";

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const currencyFormatter = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function nightCount(reservation: MockReservation): number {
  const checkIn = new Date(reservation.checkInDate).getTime();
  const checkOut = new Date(reservation.checkOutDate).getTime();
  return Math.max(1, Math.round((checkOut - checkIn) / 86_400_000));
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
    <div className="flex flex-col gap-3">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {title}
      </span>
      {children}
    </div>
  );
}

export function ReservationDetailBody({
  reservation,
}: {
  reservation: MockReservation;
}) {
  const nights = nightCount(reservation);
  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Guest">
        <DetailField label="Name" value={reservation.guestName} />
        <DetailField
          label="Party size"
          value={`${reservation.guests} ${reservation.guests === 1 ? "guest" : "guests"}`}
        />
      </DetailSection>
      <Separator />
      <DetailSection title="Stay">
        <DetailField label="Room" value={reservation.roomName} />
        <DetailField
          label="Check-in"
          value={fullDateFormatter.format(new Date(reservation.checkInDate))}
        />
        <DetailField
          label="Check-out"
          value={fullDateFormatter.format(new Date(reservation.checkOutDate))}
        />
        <DetailField
          label="Nights"
          value={`${nights} ${nights === 1 ? "night" : "nights"}`}
        />
      </DetailSection>
      <Separator />
      <DetailSection title="Payment">
        <DetailField
          label="Total"
          value={currencyFormatter.format(reservation.totalAmount)}
        />
        <DetailField
          label="Per night"
          value={currencyFormatter.format(reservation.totalAmount / nights)}
        />
      </DetailSection>
    </div>
  );
}

export function ReservationDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[3, 4, 2].map((rows, section) => (
        <div key={section} className="flex flex-col gap-3">
          <Skeleton className="h-3 w-16" />
          {Array.from({ length: rows }).map((_, row) => (
            <div key={row} className="flex justify-between gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReservationDetailPanel({
  selectedId,
  reservation,
  loading,
  onClose,
}: {
  selectedId: string | null;
  reservation: MockReservation | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="flex flex-1 flex-col overflow-hidden rounded-lg border">
      {selectedId === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <CalendarDays className="text-muted-foreground/60 size-8" />
          <p className="text-muted-foreground text-sm">
            Select a reservation to see its details.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-muted flex items-center justify-between gap-2 border-b px-4 py-3">
            {loading ? (
              <Skeleton className="h-5 w-32" />
            ) : !reservation ? (
              <span className="text-muted-foreground text-sm font-medium">
                {selectedId}
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{reservation.id}</span>
                <ReservationStatusBadge status={reservation.status} />
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onClose}
              aria-label="Close details"
            >
              <X />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <ReservationDetailSkeleton />
            ) : !reservation ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Reservation not found.
              </p>
            ) : (
              <ReservationDetailBody reservation={reservation} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
