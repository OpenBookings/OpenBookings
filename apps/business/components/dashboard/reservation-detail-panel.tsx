"use client";

import { BookingTimeline } from "@/components/dashboard/booking-timeline";
import { GuestContactSeal } from "@/components/dashboard/break-the-glass";
import { Skeleton } from "@/components/ui/skeleton";
import type { HostReservation } from "@/lib/reservations/shape";

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const ticketDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const currencyFormatter = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
});

const utcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const DAY = 86_400_000;

function nightCount(reservation: HostReservation): number {
  const nights = (utcDate(reservation.checkOutDate).getTime() - utcDate(reservation.checkInDate).getTime()) / DAY;
  return Math.max(1, Math.round(nights));
}

/** Today's date at the property, as YYYY-MM-DD. */
function propertyToday(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** A short line above the dates: how far off the stay is, at the property. */
function stayCountdown(reservation: HostReservation): string | null {
  if (reservation.status === "cancelled" || reservation.status === "no_show") return null;
  const today = utcDate(propertyToday(reservation.timezone)).getTime();
  const checkIn = utcDate(reservation.checkInDate).getTime();
  const checkOut = utcDate(reservation.checkOutDate).getTime();
  if (today > checkOut) return null;
  if (today === checkOut) return "Leaving today";
  if (today >= checkIn) return "Staying now";
  const days = Math.round((checkIn - today) / DAY);
  if (days === 0) return "Arriving today";
  if (days === 1) return "Arriving tomorrow";
  return `Arriving in ${days} days`;
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
    <section className="flex flex-col">
      <h3 className="text-foreground mb-4 border-b pb-2 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * Check-in ↔ check-out as a ticket, adapted from the guest's booking page
 * (apps/web/app/bookings/[booking-ref]): the dates lead, the nights sit
 * between them.
 */
function StayTicket({ reservation }: { reservation: HostReservation }) {
  const nights = nightCount(reservation);
  const countdown = stayCountdown(reservation);
  const nightsLabel = `${nights} ${nights === 1 ? "night" : "nights"}`;
  return (
    <section aria-label="Stay" className="rounded-lg border bg-muted">
      {countdown ? (
        <p className="text-muted-foreground px-4 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
          {countdown}
        </p>
      ) : null}
      <div className={`grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-4 pb-4 ${countdown ? "pt-2" : "pt-4"}`}>
        <div>
          <p className="text-muted-foreground text-xs">Check-in</p>
          <p className="mt-0.5 text-lg font-semibold leading-tight">{ticketDate.format(utcDate(reservation.checkInDate))}</p>
          {reservation.checkInTime ? (
            <p className="text-muted-foreground mt-0.5 text-xs">from {reservation.checkInTime}</p>
          ) : null}
        </div>
        <div className="flex h-full items-center">
          <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap">
            {nightsLabel}
          </span>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-xs">Check-out</p>
          <p className="mt-0.5 text-lg font-semibold leading-tight">{ticketDate.format(utcDate(reservation.checkOutDate))}</p>
          {reservation.checkOutTime ? (
            <p className="text-muted-foreground mt-0.5 text-xs">until {reservation.checkOutTime}</p>
          ) : null}
        </div>
      </div>
      {reservation.departedEarlyOn ? (
        <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
          Left early after the night of {fullDateFormatter.format(utcDate(reservation.departedEarlyOn))}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The rooms with their rate and price, then what was paid: quiet, it's the
 * detail. When each rate's free cancellation ends is in the timeline above.
 */
function RoomsAndPayment({ reservation }: { reservation: HostReservation }) {
  const count = reservation.rooms.length;
  return (
    <section aria-labelledby="panel-rooms">
      <h3 id="panel-rooms" className="text-muted-foreground text-xs">
        {count === 1 ? "Room" : `${count} rooms`}
      </h3>
      <ul className="mt-2 divide-y border-y">
        {reservation.rooms.map((room) => (
          <li key={room.reservationId} className="py-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className={room.cancelledAt ? "text-muted-foreground text-sm line-through" : "text-sm font-medium"}>
                  {room.roomName}
                </p>
                <p className="text-muted-foreground text-xs">
                  {room.cancelledAt ? `Cancelled ${shortDate.format(utcDate(room.cancelledAt))}` : `${room.tierLabel} rate`}
                </p>
              </div>
              <span className="text-muted-foreground text-sm tabular-nums">{currencyFormatter.format(room.paid)}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-3 flex flex-col gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-medium tabular-nums">{currencyFormatter.format(reservation.totalAmount)}</dd>
        </div>
        {reservation.refundedAmount > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Refunded</dt>
            <dd className="tabular-nums">− {currencyFormatter.format(reservation.refundedAmount)}</dd>
          </div>
        ) : null}
      </dl>
      {reservation.refundIssue ? (
        <p className="text-destructive mt-2 text-xs">A refund hasn&apos;t gone through yet. Retry it from the actions below.</p>
      ) : null}
    </section>
  );
}

export function ReservationDetailBody({
  reservation,
  seal,
}: {
  reservation: HostReservation;
  /** The guest's phone and address: sealed until someone opens them. */
  seal: React.ComponentProps<typeof GuestContactSeal>;
}) {
  return (
    <div className="flex flex-col gap-7">
      <DetailSection title="Guest">
        <DetailField label="Name" value={reservation.guestName} />
        <DetailField
          label="Party size"
          value={`${reservation.guests} ${reservation.guests === 1 ? "guest" : "guests"}`}
        />
        <GuestContactSeal {...seal} />
      </DetailSection>
      <StayTicket reservation={reservation} />
      <BookingTimeline timeline={reservation.timeline} />
      <RoomsAndPayment reservation={reservation} />
    </div>
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
