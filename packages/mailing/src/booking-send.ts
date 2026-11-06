import { getPool, query } from "@openbookings/db";
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

/** Where links in the mail point. Each app passes its own configured origins. */
export type BookingMailUrls = { webUrl: string; businessUrl: string };

const trim = (url: string) => url.replace(/\/$/, "");
const bookingUrl = (u: BookingMailUrls, bookingId: string) => `${trim(u.webUrl)}/bookings/${bookingId}`;
const reservationsUrl = (u: BookingMailUrls) => `${trim(u.businessUrl)}/dashboard/bookings/reservations`;

async function deliver(to: string[], mail: ActionMail): Promise<void> {
  const results = await Promise.allSettled(
    [...new Set(to)].map((address) =>
      getEmailClient().from(fromAddress()).to(address).subject(mail.subject).html(mail.html).send(),
    ),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

/** Both mails are attempted; the first failure is thrown afterwards. */
async function deliverAll(mails: { to: string[]; mail: ActionMail }[]): Promise<void> {
  const results = await Promise.allSettled(mails.map((m) => deliver(m.to, m.mail)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

type Guest = { guestEmail: string; guestName: string };

async function hostsOf(propertyId: string, guestEmail: string): Promise<string[]> {
  return hostRecipients(getPool(), { propertyId, guestEmail, testing: isTestingMode() });
}

const guestsText = (adults: number, children: number) => {
  const n = adults + children;
  return `${n} ${n === 1 ? "guest" : "guests"}`;
};

type BookingRow = Guest & {
  property_id: string;
  property_name: string;
  check_in_date: string;
  check_out_date: string;
  total: number;
  rooms: { name: string; rate_plan: string; adults: number; children: number; free_until: string | null }[];
};

async function loadBooking(bookingId: string): Promise<BookingRow | null> {
  const rows = await query<BookingRow>(
    `SELECT p.id AS property_id, p.name AS property_name,
            b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
            u.email AS "guestEmail", COALESCE(u.name, u.email) AS "guestName",
            COALESCE((SELECT SUM((n->>'price')::numeric + (n->>'touristTax')::numeric)
                        FROM reservations r, jsonb_array_elements(r.nights) n
                       WHERE r.booking_id = b.id), 0)::float8 AS total,
            COALESCE((
              SELECT json_agg(json_build_object(
                'name', rm.name, 'rate_plan', rp.name, 'adults', r.adults, 'children', r.children,
                'free_until', to_char(r.full_refund_until AT TIME ZONE p.timezone, 'YYYY-MM-DD')
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

const mailRooms = (rooms: BookingRow["rooms"]): MailRoom[] =>
  rooms.map((r) => ({
    name: r.name,
    ratePlan: r.rate_plan,
    guests: guestsText(r.adults, r.children),
    freeCancellationUntil: r.free_until ? formatStayDate(r.free_until) : null,
  }));

/** The guest's confirmation and the host's new-booking notice. */
export async function sendBookingConfirmed(bookingId: string, urls: BookingMailUrls): Promise<void> {
  const b = await loadBooking(bookingId);
  if (!b) throw new Error(`Booking ${bookingId} not found for its confirmation email`);
  const shared = { propertyName: b.property_name, checkIn: b.check_in_date, checkOut: b.check_out_date, rooms: mailRooms(b.rooms), total: formatEuro(b.total) };
  await deliverAll([
    { to: [b.guestEmail], mail: guestBookingConfirmed({ ...shared, bookingUrl: bookingUrl(urls, bookingId) }) },
    {
      to: await hostsOf(b.property_id, b.guestEmail),
      mail: hostNewBooking({ ...shared, guestName: b.guestName, reservationsUrl: reservationsUrl(urls) }),
    },
  ]);
}

/** Tells a guest whose rooms were gone that they were refunded in full. */
export async function sendOversoldRefunded(intentId: string, urls: BookingMailUrls): Promise<void> {
  const rows = await query<{ guestEmail: string; property_name: string; amount: number }>(
    `SELECT u.email AS "guestEmail", p.name AS property_name,
            (i.total_amount + i.tourist_tax_amount)::float8 AS amount
       FROM booking_intents i
       JOIN properties p ON p.id = i.property_id
       JOIN "user" u ON u.id = i.user_id
      WHERE i.id = $1::uuid`,
    [intentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Intent ${intentId} not found for its refund email`);
  await deliver(
    [row.guestEmail],
    guestOversoldRefunded({
      propertyName: row.property_name,
      amount: formatEuro(row.amount),
      searchUrl: `${trim(urls.webUrl)}/search`,
    }),
  );
}

/**
 * Tells the guest and the host that rooms were cancelled. Which rooms, and
 * the refund, come from the booking's latest `rooms_cancelled` event, written
 * in the cancelling transaction. Never throws: a failed email must not undo or
 * mask a cancellation that already happened.
 */
export async function sendBookingCancelled(bookingId: string, urls: BookingMailUrls): Promise<void> {
  try {
    const rows = await query<Guest & { property_id: string; property_name: string; rooms: string[]; refund: number }>(
      `SELECT p.id AS property_id, p.name AS property_name,
              u.email AS "guestEmail", COALESCE(u.name, u.email) AS "guestName",
              COALESCE((
                SELECT json_agg(rm.name ORDER BY r.created_at, r.id)
                  FROM reservations r JOIN rooms rm ON rm.id = r.room_id
                 WHERE r.id::text IN (SELECT jsonb_array_elements_text(e.data->'reservationIds'))
              ), '[]'::json) AS rooms,
              COALESCE((e.data->>'refundTotal')::float8, 0) AS refund
         FROM booking_events e
         JOIN bookings b ON b.id = e.booking_id
         JOIN properties p ON p.id = b.hotel_id
         JOIN "user" u ON u.id = b.user_id
        WHERE e.booking_id = $1::uuid AND e.kind = 'rooms_cancelled'
        ORDER BY e.created_at DESC
        LIMIT 1`,
      [bookingId],
    );
    const c = rows[0];
    if (!c) throw new Error(`No cancellation recorded for booking ${bookingId}`);
    await deliverAll([
      {
        to: [c.guestEmail],
        mail: guestBookingCancelled({
          propertyName: c.property_name,
          rooms: c.rooms,
          refund: formatEuro(c.refund),
          bookingUrl: bookingUrl(urls, bookingId),
        }),
      },
      {
        to: await hostsOf(c.property_id, c.guestEmail),
        mail: hostBookingCancelled({
          propertyName: c.property_name,
          guestName: c.guestName,
          rooms: c.rooms,
          reservationsUrl: reservationsUrl(urls),
        }),
      },
    ]);
  } catch (error) {
    console.error("[booking-mail] cancellation email failed:", error instanceof Error ? error.message : error);
  }
}
