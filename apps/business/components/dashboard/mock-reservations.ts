export type MockReservationStatus =
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "pending";

export type MockReservation = {
  id: string;
  guestName: string;
  roomName: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  status: MockReservationStatus;
  totalAmount: number;
};

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// Placeholder data shaped like the bookings/reservations schema.
// Dates are relative to today so every dashboard bucket stays populated.
export const mockReservations: MockReservation[] = [
  { id: "RES-1041", guestName: "Emma de Vries", roomName: "Deluxe Double 12", checkInDate: isoDate(0), checkOutDate: isoDate(3), guests: 2, status: "confirmed", totalAmount: 486 },
  { id: "RES-1042", guestName: "Lucas Janssen", roomName: "Standard Twin 04", checkInDate: isoDate(0), checkOutDate: isoDate(2), guests: 2, status: "confirmed", totalAmount: 258 },
  { id: "RES-1043", guestName: "Sofia Rossi", roomName: "Junior Suite 21", checkInDate: isoDate(0), checkOutDate: isoDate(5), guests: 3, status: "pending", totalAmount: 1125 },
  { id: "RES-1029", guestName: "Thomas Müller", roomName: "Standard Double 08", checkInDate: isoDate(-2), checkOutDate: isoDate(0), guests: 1, status: "checked_in", totalAmount: 276 },
  { id: "RES-1031", guestName: "Claire Dubois", roomName: "Deluxe King 15", checkInDate: isoDate(-3), checkOutDate: isoDate(0), guests: 2, status: "checked_in", totalAmount: 594 },
  { id: "RES-1033", guestName: "Jan Kowalski", roomName: "Family Room 18", checkInDate: isoDate(-1), checkOutDate: isoDate(2), guests: 4, status: "checked_in", totalAmount: 675 },
  { id: "RES-1035", guestName: "Ingrid Larsen", roomName: "Standard Twin 02", checkInDate: isoDate(-4), checkOutDate: isoDate(1), guests: 2, status: "checked_in", totalAmount: 645 },
  { id: "RES-1050", guestName: "Miguel Santos", roomName: "Junior Suite 22", checkInDate: isoDate(1), checkOutDate: isoDate(4), guests: 2, status: "confirmed", totalAmount: 810 },
  { id: "RES-1051", guestName: "Anna Bakker", roomName: "Standard Double 06", checkInDate: isoDate(2), checkOutDate: isoDate(6), guests: 2, status: "confirmed", totalAmount: 552 },
  { id: "RES-1052", guestName: "David Cohen", roomName: "Deluxe Double 11", checkInDate: isoDate(3), checkOutDate: isoDate(5), guests: 1, status: "pending", totalAmount: 324 },
  { id: "RES-1053", guestName: "Yuki Tanaka", roomName: "Deluxe King 16", checkInDate: isoDate(5), checkOutDate: isoDate(9), guests: 2, status: "confirmed", totalAmount: 792 },
];

export type ReservationBuckets = {
  upcoming: MockReservation[];
  checkIns: MockReservation[];
  checkOuts: MockReservation[];
  inHouse: MockReservation[];
};

export function bucketReservations(
  reservations: MockReservation[]
): ReservationBuckets {
  const today = isoDate(0);
  return {
    upcoming: reservations.filter((r) => r.checkInDate > today),
    checkIns: reservations.filter((r) => r.checkInDate === today),
    checkOuts: reservations.filter((r) => r.checkOutDate === today),
    inHouse: reservations.filter((r) => r.status === "checked_in"),
  };
}
