import { loadBookingEvents, type BookingEvent, type Queryable } from "@openbookings/db";
import { UUID_RE } from "./search";

export type AdminBooking = {
  booking: Record<string, unknown> & {
    id: string;
    status: string;
    user_id: string;
    created_at: Date;
    confirmed_at: Date | null;
    cancelled_at: Date | null;
    no_show_reported_at: Date | null;
    departed_early_on: string | null;
    hotel_id: string;
  };
  guest: { id: string; name: string | null; email: string | null } | null;
  property: { id: string; name: string; ownerUserId: string | null; timezone: string };
  rooms: (Record<string, unknown> & {
    id: string;
    room_name: string;
    rate_plan_name: string;
    cancelled_at: Date | null;
  })[];
  transactions: (Record<string, unknown> & {
    id: string;
    type: string;
    amount: number;
    status: string;
    created_at: Date;
  })[];
  refunds: (Record<string, unknown> & {
    id: string;
    reservation_id: string | null;
    reason: string;
    amount: number;
    status: string;
    created_by: string | null;
    created_at: Date;
  })[];
  messages: { id: string; sender_role: string; body: string; created_at: Date }[];
  tickets: {
    id: string;
    title: string;
    category: string;
    status: string;
    chatwoot_conversation_id: number;
    last_activity_at: Date;
  }[];
  events: BookingEvent[];
};

/** Run queries one after another: a single pg Client cannot run them in parallel. */
async function seq<T>(queries: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (const q of queries) out.push(await q());
  return out;
}

export async function loadAdminBooking(db: Queryable, id: string): Promise<AdminBooking | null> {
  if (!UUID_RE.test(id)) return null;
  const b = await db.query(
    `SELECT b.*, to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in_date,
            to_char(b.check_out_date, 'YYYY-MM-DD') AS check_out_date,
            to_char(b.departed_early_on, 'YYYY-MM-DD') AS departed_early_on,
            b.total_amount::float8 AS total_amount,
            b.booking_fee_amount::float8 AS booking_fee_amount
       FROM bookings b WHERE b.id = $1::uuid`,
    [id],
  );
  const booking = b.rows[0] as AdminBooking["booking"] | undefined;
  if (!booking) return null;

  const guest = await db.query(`SELECT id, name, email FROM "user" WHERE id = $1`, [booking.user_id]);
  const property = await db.query(`SELECT id, name, owner_user_id, timezone FROM properties WHERE id = $1`, [booking.hotel_id]);
  const [rooms, transactions, refunds, messages, tickets] = await seq([
    () => db.query(
      `SELECT r.*, rm.name AS room_name, rp.name AS rate_plan_name,
              r.price_per_night::float8 AS price_per_night,
              r.total_amount::float8 AS total_amount,
              r.tourist_tax_amount::float8 AS tourist_tax_amount
         FROM reservations r
         LEFT JOIN rooms rm ON rm.id = r.room_id
         LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
        WHERE r.booking_id = $1::uuid ORDER BY r.created_at, r.id`,
      [id],
    ),
    () => db.query(
      `SELECT t.*, t.amount::float8 AS amount FROM transactions t
        WHERE t.booking_id = $1::uuid ORDER BY t.created_at, t.id`,
      [id],
    ),
    () => db.query(
      `SELECT f.*, f.amount::float8 AS amount,
              f.accommodation_amount::float8 AS accommodation_amount,
              f.tourist_tax_amount::float8 AS tourist_tax_amount
         FROM refunds f WHERE f.booking_id = $1::uuid ORDER BY f.created_at, f.id`,
      [id],
    ),
    () => db.query(
      `SELECT m.id, m.sender_role, m.body, m.created_at
         FROM messages m JOIN message_threads t ON t.id = m.thread_id
        WHERE t.booking_id = $1::uuid ORDER BY m.created_at, m.id`,
      [id],
    ),
    () => db.query(
      `SELECT id, title, category, status, chatwoot_conversation_id::float8 AS chatwoot_conversation_id,
              last_activity_at
         FROM support_tickets
        WHERE linked_type = 'booking' AND linked_id = $1 ORDER BY last_activity_at DESC`,
      [id],
    ),
  ]);
  const events = await loadBookingEvents(db, id);

  const p = property.rows[0] as { id: string; name: string; owner_user_id: string | null; timezone: string };
  return {
    booking,
    guest: (guest.rows[0] as AdminBooking["guest"]) ?? null,
    property: { id: p.id, name: p.name, ownerUserId: p.owner_user_id, timezone: p.timezone },
    rooms: rooms.rows as AdminBooking["rooms"],
    transactions: transactions.rows as AdminBooking["transactions"],
    refunds: refunds.rows as AdminBooking["refunds"],
    messages: messages.rows as AdminBooking["messages"],
    tickets: tickets.rows as AdminBooking["tickets"],
    events,
  };
}
