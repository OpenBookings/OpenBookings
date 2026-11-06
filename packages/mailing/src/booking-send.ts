import { getPool } from "@openbookings/db";
import { hostRecipients, isTestingMode } from "@openbookings/demo";
import { getEmailClient } from "./client";
import {
  guestBookingCancelled,
  guestBookingConfirmed,
  guestOversoldRefunded,
  hostBookingCancelled,
  hostNewBooking,
  type MailRoom,
} from "./booking-mail";
import { formatEuro, formatStayDate } from "./format";
import type { ActionMail } from "./action-mail";

/**
 * Loads a booking and sends its emails. The pure wording is in ./booking-mail;
 * this file is the part that touches the database and the mail provider, shared
 * by the three apps that can cancel a booking (web, business, admin).
 */

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";
const fromAddress = () => process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;

export type BookingMailUrls = { webUrl: string; businessUrl: string };

/** The origins the apps already use for absolute links, with their defaults. */
export function bookingMailUrls(): BookingMailUrls {
  return {
    webUrl: process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co",
    businessUrl: process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co",
  };
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
type Transport = (m: { to: string; subject: string; html: string }) => Promise<void>;

/** Everything a sender needs. Production passes nothing; tests inject all of it. */
export type SendDeps = {
  db?: Db;
  transport?: Transport;
  testing?: boolean;
  urls?: BookingMailUrls;
};

const resolve = (d: SendDeps) => ({
  db: d.db ?? getPool(),
  transport: d.transport ?? ((m) => getEmailClient().from(fromAddress()).to(m.to).subject(m.subject).html(m.html).send().then(() => undefined)),
  testing: d.testing ?? isTestingMode(),
  urls: d.urls ?? bookingMailUrls(),
});
type Ctx = ReturnType<typeof resolve>;

const trim = (url: string) => url.replace(/\/$/, "");
const bookingUrl = (c: Ctx, bookingId: string) => `${trim(c.urls.webUrl)}/bookings/${bookingId}`;
const reservationsUrl = (c: Ctx) => `${trim(c.urls.businessUrl)}/dashboard/bookings/reservations`;

async function rowsOf<T>(db: Db, text: string, values: unknown[]): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

/** One mail to one or more addresses; every address is tried, the first failure thrown after. */
async function deliver(c: Ctx, to: string[], mail: ActionMail): Promise<void> {
  const results = await Promise.allSettled([...new Set(to)].map((address) => c.transport({ to: address, subject: mail.subject, html: mail.html })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * Each mail is its own branch: its recipients are resolved and sent inside it,
 * so a failed host lookup cannot stop the guest's mail. Every branch runs; the
 * first failure is thrown afterwards.
 */
async function deliverAll(branches: (() => Promise<void>)[]): Promise<void> {
  const results = await Promise.allSettled(branches.map((b) => b()));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

const hostsOf = (c: Ctx, propertyId: string, guestEmail: string) =>
  hostRecipients(c.db, { propertyId, guestEmail, testing: c.testing });

type BookingRow = {
  property_id: string;
  property_name: string;
  guestEmail: string;
  guestName: string;
  check_in_date: string;
  check_out_date: string;
  total: number;
  rooms: { name: string; rate_plan: string; adults: number; children: number; free_until: string | null }[];
};

async function loadBooking(c: Ctx, bookingId: string): Promise<BookingRow | null> {
  const rows = await rowsOf<BookingRow>(
    c.db,
    `SELECT p.id AS property_id, p.name AS property_name,
            b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
            u.email AS "guestEmail", COALESCE(u.name, u.email) AS "guestName",
            COALESCE((SELECT SUM((n->>'price')::numeric + (n->>'touristTax')::numeric)
                        FROM reservations r, jsonb_array_elements(r.nights) n
                       WHERE r.booking_id = b.id), 0)::float8 AS total,
            COALESCE((
              SELECT json_agg(json_build_object(
                'name', rm.name, 'rate_plan', rp.name, 'adults', r.adults, 'children', r.children,
                -- A deadline that has passed is no longer a free-cancellation promise.
                'free_until', CASE WHEN r.full_refund_until > NOW()
                  THEN to_char(r.full_refund_until AT TIME ZONE p.timezone, 'YYYY-MM-DD HH24:MI') END
              ) ORDER BY r.created_at, r.id)
              FROM reservations r
              JOIN rooms rm ON rm.id = r.room_id
              JOIN rate_plans rp ON rp.id = r.rate_plan_id
              WHERE r.booking_id = b.id
            ), '[]'::json) AS rooms
       FROM bookings b
       JOIN properties p ON p.id = b.hotel_id
       JOIN "user" u ON u.id = b.user_id
      WHERE b.id = $1::uuid`,
    [bookingId],
  );
  return rows[0] ?? null;
}

const guestsText = (adults: number, children: number) => {
  const n = adults + children;
  return `${n} ${n === 1 ? "guest" : "guests"}`;
};

/** "Thu 11 Mar 2027, 15:00" from "2027-03-11 15:00" (the property's local time). */
function deadline(local: string | null): string | null {
  if (!local) return null;
  const [date, time] = local.split(" ");
  return `${formatStayDate(date!)}, ${time}`;
}

const mailRooms = (rooms: BookingRow["rooms"]): MailRoom[] =>
  rooms.map((r) => ({
    name: r.name,
    ratePlan: r.rate_plan,
    guests: guestsText(r.adults, r.children),
    freeCancellationUntil: deadline(r.free_until),
  }));

/** The guest's confirmation and the host's new-booking notice. */
export async function sendBookingConfirmed(bookingId: string, deps: SendDeps = {}): Promise<void> {
  const c = resolve(deps);
  const b = await loadBooking(c, bookingId);
  if (!b) throw new Error(`Booking ${bookingId} not found for its confirmation email`);
  const shared = { propertyName: b.property_name, checkIn: b.check_in_date, checkOut: b.check_out_date, rooms: mailRooms(b.rooms), total: formatEuro(b.total) };
  await deliverAll([
    () => deliver(c, [b.guestEmail], guestBookingConfirmed({ ...shared, bookingUrl: bookingUrl(c, bookingId) })),
    async () =>
      deliver(
        c,
        await hostsOf(c, b.property_id, b.guestEmail),
        hostNewBooking({ ...shared, guestName: b.guestName, reservationsUrl: reservationsUrl(c) }),
      ),
  ]);
}

/** Tells a guest whose rooms were gone that they were refunded in full. */
export async function sendOversoldRefunded(intentId: string, deps: SendDeps = {}): Promise<void> {
  const c = resolve(deps);
  const row = (
    await rowsOf<{ guestEmail: string; property_name: string; amount: number }>(
      c.db,
      `SELECT u.email AS "guestEmail", p.name AS property_name,
              i.total_amount::float8 AS amount -- what was charged and refunded; includes tourist tax
         FROM booking_intents i
         JOIN properties p ON p.id = i.property_id
         JOIN "user" u ON u.id = i.user_id
        WHERE i.id = $1::uuid`,
      [intentId],
    )
  )[0];
  if (!row) throw new Error(`Intent ${intentId} not found for its refund email`);
  await deliver(
    c,
    [row.guestEmail],
    guestOversoldRefunded({ propertyName: row.property_name, amount: formatEuro(row.amount), searchUrl: `${trim(c.urls.webUrl)}/search` }),
  );
}

/** What `cancelRooms` returned in `cancelled`. */
export type CancelledRooms = { reservationIds: string[]; refundTotal: number; cancelsBooking: boolean };

/**
 * Tells the guest and the host which rooms a cancelRooms call cancelled, from
 * what that call returned (not from the booking's latest state, which a second
 * cancellation may already have moved on). Never throws: a failed email must
 * not mask a cancellation that already happened; `report` hears about it.
 */
export async function sendBookingCancelled(
  bookingId: string,
  cancelled: CancelledRooms,
  report: (error: unknown, context: { kind: string; bookingId: string }) => void = (error) =>
    console.error("[booking-mail] cancellation email failed:", error instanceof Error ? error.message : error),
  deps: SendDeps = {},
): Promise<void> {
  try {
    const c = resolve(deps);
    const row = (
      await rowsOf<{ property_id: string; property_name: string; guestEmail: string; guestName: string; rooms: string[] }>(
        c.db,
        `SELECT p.id AS property_id, p.name AS property_name,
                u.email AS "guestEmail", COALESCE(u.name, u.email) AS "guestName",
                COALESCE((
                  SELECT json_agg(rm.name ORDER BY r.created_at, r.id)
                    FROM reservations r JOIN rooms rm ON rm.id = r.room_id
                   WHERE r.booking_id = b.id AND r.id = ANY($2::uuid[])
                ), '[]'::json) AS rooms
           FROM bookings b
           JOIN properties p ON p.id = b.hotel_id
           JOIN "user" u ON u.id = b.user_id
          WHERE b.id = $1::uuid`,
        [bookingId, cancelled.reservationIds],
      )
    )[0];
    if (!row) throw new Error(`Booking ${bookingId} not found for its cancellation email`);
    const { cancelsBooking } = cancelled;
    await deliverAll([
      () =>
        deliver(
          c,
          [row.guestEmail],
          guestBookingCancelled({
            propertyName: row.property_name,
            rooms: row.rooms,
            refund: cancelled.refundTotal > 0 ? formatEuro(cancelled.refundTotal) : null,
            cancelsBooking,
            bookingUrl: bookingUrl(c, bookingId),
          }),
        ),
      async () =>
        deliver(
          c,
          await hostsOf(c, row.property_id, row.guestEmail),
          hostBookingCancelled({
            propertyName: row.property_name,
            guestName: row.guestName,
            rooms: row.rooms,
            cancelsBooking,
            reservationsUrl: reservationsUrl(c),
          }),
        ),
    ]);
  } catch (error) {
    try {
      report(error, { kind: "cancellation", bookingId });
    } catch {
      // Reporting must not throw either.
    }
  }
}
