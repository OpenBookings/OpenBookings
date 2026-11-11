"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReservationStatusBadge } from "@/components/dashboard/reservation-status";
import type { ReservationSummary as MockReservation } from "@/components/dashboard/reservation-types";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const currencyFormatter = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function ReservationsTable({
  reservations,
  emptyMessage,
  selectedId,
  onSelect,
}: {
  reservations: MockReservation[];
  emptyMessage: string;
  selectedId?: string | null;
  onSelect?: (reservation: MockReservation) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Reservation</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Check-in</TableHead>
            <TableHead>Check-out</TableHead>
            <TableHead className="text-right">Guests</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-muted-foreground h-24 text-center"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            reservations.map((reservation) => (
              <TableRow
                key={reservation.id}
                data-state={
                  selectedId === reservation.id ? "selected" : undefined
                }
                className={onSelect ? "cursor-pointer" : undefined}
                onClick={onSelect ? () => onSelect(reservation) : undefined}
              >
                <TableCell className="font-medium">{reservation.reference}</TableCell>
                <TableCell>{reservation.guestName}</TableCell>
                <TableCell>{reservation.roomName}</TableCell>
                <TableCell>
                  {dateFormatter.format(new Date(reservation.checkInDate))}
                </TableCell>
                <TableCell>
                  {dateFormatter.format(new Date(reservation.checkOutDate))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {reservation.guests}
                  {reservation.extrasLabel ? (
                    <span className="text-muted-foreground block text-xs">{reservation.extrasLabel}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ReservationStatusBadge status={reservation.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {currencyFormatter.format(reservation.totalAmount)}
                  {reservation.atHotelAmount ? (
                    <span className="text-muted-foreground block text-xs">
                      + {currencyFormatter.format(reservation.atHotelAmount)} at the hotel
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
