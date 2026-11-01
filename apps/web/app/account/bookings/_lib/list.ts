import type { BookingStatus } from "@openbookings/pricing";

/** One row of GUEST_BOOKINGS_SQL. Dates are `YYYY-MM-DD` text. */
export type GuestBookingListRow = {
  booking_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  property_name: string;
  property_slug: string;
  city: string | null;
  hero_image_url: string | null;
  /** Rooms still booked (cancelled rooms left out, unless every room is). */
  rooms: number;
  guests: number;
  /** What the guest paid, tourist tax included, in euros. */
  total_paid: number;
};

export type BookingTab = "upcoming" | "past" | "cancelled";

export const BOOKING_TABS: { id: BookingTab; title: string }[] = [
  { id: "upcoming", title: "Upcoming" },
  { id: "past", title: "Past" },
  { id: "cancelled", title: "Cancelled" },
];

/**
 * Every booking of one guest. Pending rows are unpaid checkout intents, not
 * bookings, and are never listed. Scoped to `$1` (the session's user id) —
 * nothing else filters this.
 */
export const GUEST_BOOKINGS_SQL = `
  SELECT
    b.id AS booking_id,
    b.status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    p.name AS property_name,
    p.slug AS property_slug,
    p.city,
    (
      SELECT pi.url FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi."group" = 'hero-image' THEN 0 ELSE 1 END), pi.sort_order, pi.created_at
      LIMIT 1
    ) AS hero_image_url,
    COALESCE(NULLIF(
      (SELECT count(*) FROM reservations r WHERE r.booking_id = b.id AND r.cancelled_at IS NULL), 0),
      (SELECT count(*) FROM reservations r WHERE r.booking_id = b.id))::int AS rooms,
    COALESCE((SELECT SUM(r.adults + r.children) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS guests,
    COALESCE(NULLIF((
      SELECT SUM((n->>'price')::numeric + COALESCE((n->>'touristTax')::numeric, 0))
      FROM reservations r, jsonb_array_elements(r.nights) n
      WHERE r.booking_id = b.id
    ), 0), b.total_amount)::float8 AS total_paid
  FROM bookings b
  JOIN properties p ON p.id = b.hotel_id
  WHERE b.user_id = $1 AND b.status <> 'pending'
`;

/** Which tab a booking belongs on, on the guest's calendar day `today`. */
export function classifyBooking(row: GuestBookingListRow, today: string): BookingTab {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "completed" || row.status === "no_show") return "past";
  // ISO dates compare correctly as strings. Checkout day itself is still the stay.
  return row.check_out_date < today ? "past" : "upcoming";
}

export function groupBookings(
  rows: GuestBookingListRow[],
  today: string,
): Record<BookingTab, GuestBookingListRow[]> {
  const groups: Record<BookingTab, GuestBookingListRow[]> = { upcoming: [], past: [], cancelled: [] };
  for (const row of rows) groups[classifyBooking(row, today)].push(row);
  const soonest = (a: GuestBookingListRow, b: GuestBookingListRow) => a.check_in_date.localeCompare(b.check_in_date);
  groups.upcoming.sort(soonest);
  groups.past.sort((a, b) => soonest(b, a));
  groups.cancelled.sort((a, b) => soonest(b, a));
  return groups;
}

export function parseTab(value: string | string[] | undefined): BookingTab {
  return value === "past" || value === "cancelled" ? value : "upcoming";
}
