/**
 * What the reservations list, table and tabs show for one booking. Real
 * bookings (lib/reservations) and the dashboard's remaining mock data both
 * fit this shape.
 */
export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export type ReservationSummary = {
  id: string;
  /** Short reference shown to hosts and guests, e.g. "B0000000". */
  reference: string;
  guestName: string;
  roomName: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  status: ReservationStatus;
  totalAmount: number;
};

export type ReservationBuckets<T extends ReservationSummary = ReservationSummary> = {
  upcoming: T[];
  checkIns: T[];
  checkOuts: T[];
  inHouse: T[];
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Cancelled bookings and no-shows are not arriving, leaving or staying. */
export function bucketReservations<T extends ReservationSummary>(
  reservations: T[],
  today: string = isoDate(new Date()),
): ReservationBuckets<T> {
  const live = reservations.filter((r) => r.status !== "cancelled" && r.status !== "no_show");
  return {
    upcoming: live.filter((r) => r.checkInDate > today),
    checkIns: live.filter((r) => r.checkInDate === today),
    checkOuts: live.filter((r) => r.checkOutDate === today),
    inHouse: live.filter((r) => r.status === "checked_in"),
  };
}
