import { getPool } from "@openbookings/db";
import { bookingReference } from "@openbookings/db/booking-reference";
import { hostRecipients, isTestingMode } from "@openbookings/demo";
import { getEmailClient } from "./client";
import { sender } from "./senders";
import {
  guestBookingCancelled,
  guestBookingConfirmed,
  guestOversoldRefunded,
  guestRefundIssued,
  hostBookingCancelled,
  hostChannelDeliveryFailed,
  hostNewBooking,
  type MailRoom,
  type RefundIssuedReason,
} from "./booking-mail";
import { formatStayDate, mailCents } from "./format";
import type { ActionMail } from "./action-mail";
import { trackMail, type EmailKind } from "./tracking";

/**
 * Loads a booking and sends its emails. The pure wording is in ./booking-mail;
 * this file is the part that touches the database and the mail provider, shared
 * by the three apps that can cancel a booking (web, business, admin).
 */


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
  track?: typeof trackMail;
};

const resolve = (d: SendDeps) => ({
  db: d.db ?? getPool(),
  transport: d.transport ?? ((m) => getEmailClient().from(sender("bookings")).to(m.to).subject(m.subject).html(m.html).send().then(() => undefined)),
  testing: d.testing ?? isTestingMode(),
  urls: d.urls ?? bookingMailUrls(),
  track: d.track ?? trackMail,
});
type Ctx = ReturnType<typeof resolve>;

const trim = (url: string) => url.replace(/\/$/, "");
const bookingUrl = (c: Ctx, bookingId: string) => `${trim(c.urls.webUrl)}/bookings/${bookingId}`;
const reservationsUrl = (c: Ctx) => `${trim(c.urls.businessUrl)}/dashboard/bookings/reservations`;

async function rowsOf<T>(db: Db, text: string, values: unknown[]): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

/**
 * One mail to one or more addresses; every address is tried, the first failure thrown after.
 * With a `kind` each address is tracked on its own: the tracked html is what is sent, and
 * `onSent` runs only once the transport resolved for that address.
 */
async function deliver(c: Ctx, to: string[], mail: ActionMail, kind?: EmailKind): Promise<void> {
  const results = await Promise.allSettled(
    [...new Set(to)].map(async (address) => {
      const t = kind ? await c.track({ kind, to: address, html: mail.html }) : null;
      await c.transport({ to: address, subject: mail.subject, html: t ? t.html : mail.html });
      await t?.onSent();
    }),
  );
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
  legal_name: string | null;
  vat_number: string | null;
  guestEmail: string;
  guestName: string;
  check_in_date: string;
  check_out_date: string;
  rooms_total_cents: number;
  tourist_tax_cents: number;
  total_cents: number;
  commission_cents: number;
  /** Owed at the hotel for cots and extra beds, never charged online; cents. */
  pay_at_property_cents: number;
  rooms: {
    name: string;
    rate_plan: string;
    adults: number;
    children: number;
    infants: number;
    cots: number;
    extra_beds: number;
    /** False only for a non-refundable rate: the room price never comes back. */
    refundable: boolean;
    free_until: string | null;
    nights: { date: string; priceCents: number }[];
    tax_lines: { label: string; amountCents: number }[];
  }[];
};

async function loadBooking(c: Ctx, bookingId: string): Promise<BookingRow | null> {
  const rows = await rowsOf<BookingRow>(
    c.db,
    `SELECT p.id AS property_id, p.name AS property_name,
            pc.legal_company_name AS legal_name, pc.vat_number,
            b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
            u.email AS "guestEmail", COALESCE(u.name, u.email) AS "guestName",
            b.rooms_total_cents::float8 AS rooms_total_cents, b.tourist_tax_cents::float8 AS tourist_tax_cents,
            b.total_cents::float8 AS total_cents, b.commission_cents::float8 AS commission_cents,
            (SELECT COALESCE(SUM(r.pay_at_property_cents), 0)::float8
               FROM reservations r WHERE r.booking_id = b.id AND r.cancelled_at IS NULL) AS pay_at_property_cents,
            COALESCE((
              SELECT json_agg(json_build_object(
                'name', rm.name, 'rate_plan', rp.name, 'adults', r.adults, 'children', r.children,
                'infants', r.infants, 'cots', r.cots, 'extra_beds', r.extra_beds,
                -- The tier the room was booked under; the rate's flag for one not snapshotted yet.
                'refundable', COALESCE(r.cancellation_tier::text <> 'non_refundable', rp.is_refundable),
                -- A deadline that has passed is no longer a free-cancellation promise.
                'free_until', CASE WHEN r.full_refund_until > NOW()
                  THEN to_char(r.full_refund_until AT TIME ZONE p.timezone, 'YYYY-MM-DD HH24:MI') END,
                'nights', r.nights,
                'tax_lines', r.tourist_tax_lines
              ) ORDER BY r.created_at, r.id)
              FROM reservations r
              JOIN rooms rm ON rm.id = r.room_id
              JOIN rate_plans rp ON rp.id = r.rate_plan_id
              WHERE r.booking_id = b.id
            ), '[]'::json) AS rooms
       FROM bookings b
       JOIN properties p ON p.id = b.hotel_id
       LEFT JOIN property_content pc ON pc.property_id = p.id
       JOIN "user" u ON u.id = b.user_id
      WHERE b.id = $1::uuid`,
    [bookingId],
  );
  return rows[0] ?? null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 guests", or "2 guests, 1 infant": infants (under 2) take no place, so they are not guests. */
const guestsText = (adults: number, children: number, infants = 0) =>
  [plural(adults + children, "guest", "guests"), infants > 0 && plural(infants, "infant", "infants")].filter(Boolean).join(", ");

/** "1 cot", "1 cot, 2 extra beds", or null when the room has neither. */
const extrasText = (cots = 0, extraBeds = 0) =>
  [cots > 0 && plural(cots, "cot", "cots"), extraBeds > 0 && plural(extraBeds, "extra bed", "extra beds")].filter(Boolean).join(", ") || null;

/**
 * "Thu 11 Mar 2027, 15:00 (property's local time)" from "2027-03-11 15:00".
 * The guest may be in another time zone, so the mail says whose clock it is.
 */
function deadline(local: string | null): string | null {
  if (!local) return null;
  const [date, time] = local.split(" ");
  return `${formatStayDate(date!)}, ${time} (property's local time)`;
}

const mailRooms = (rooms: BookingRow["rooms"]): MailRoom[] =>
  rooms.map((r) => ({
    name: r.name,
    ratePlan: r.rate_plan,
    guests: guestsText(r.adults, r.children, r.infants),
    extras: extrasText(r.cots, r.extra_beds),
    refundable: r.refundable !== false,
    freeCancellationUntil: deadline(r.free_until),
    nights: r.nights.map((n) => ({ date: n.date, priceCents: Number(n.priceCents) })),
    touristTaxLines: r.tax_lines.map((t) => ({ label: t.label, amountCents: Number(t.amountCents) })),
  }));

/** The guest's confirmation and the host's new-booking notice. */
export async function sendBookingConfirmed(bookingId: string, deps: SendDeps = {}): Promise<void> {
  const c = resolve(deps);
  const b = await loadBooking(c, bookingId);
  if (!b) throw new Error(`Booking ${bookingId} not found for its confirmation email`);
  const shared = {
    propertyName: b.property_name,
    checkIn: b.check_in_date,
    checkOut: b.check_out_date,
    rooms: mailRooms(b.rooms),
    money: {
      roomsCents: b.rooms_total_cents,
      touristTaxCents: b.tourist_tax_cents,
      totalCents: b.total_cents,
      payAtPropertyCents: Number(b.pay_at_property_cents) || 0,
    },
    reference: bookingReference(bookingId),
  };
  const seller = { legalName: b.legal_name, vatNumber: b.vat_number };
  await deliverAll([
    () => deliver(c, [b.guestEmail], guestBookingConfirmed({ ...shared, seller, bookingUrl: bookingUrl(c, bookingId) }), "booking_confirmed_guest"),
    async () =>
      deliver(
        c,
        await hostsOf(c, b.property_id, b.guestEmail),
        hostNewBooking({ ...shared, guestName: b.guestName, commissionCents: b.commission_cents, reservationsUrl: reservationsUrl(c) }),
        "booking_new_host",
      ),
  ]);
}

/** Tells a guest whose rooms were gone that they were refunded in full. */
export async function sendOversoldRefunded(intentId: string, deps: SendDeps = {}): Promise<void> {
  const c = resolve(deps);
  const row = (
    await rowsOf<{ guestEmail: string; property_name: string; total_cents: number }>(
      c.db,
      `SELECT u.email AS "guestEmail", p.name AS property_name,
              i.total_cents::float8 AS total_cents -- what was charged and refunded; includes tourist tax
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
    guestOversoldRefunded({ propertyName: row.property_name, amount: mailCents(row.total_cents), searchUrl: `${trim(c.urls.webUrl)}/search` }),
  );
}

/**
 * What `cancelRooms` returned in `cancelled`, in cents. `refundFailedCents`
 * is the part of `refundTotalCents` Stripe refused (absent: none).
 */
export type CancelledRooms = { reservationIds: string[]; refundTotalCents: number; refundFailedCents?: number; cancelsBooking: boolean };

/** Splits a refund (cents) into what went (or is on its way) and what Stripe refused, formatted; null for nothing. */
function refundAmounts(totalCents: number, failedCents: number): { refund: string | null; refundFailed: string | null } {
  const total = Math.max(totalCents, 0);
  const failed = Math.min(Math.max(failedCents, 0), total);
  const sent = total - failed;
  return {
    refund: sent > 0 ? mailCents(sent) : null,
    refundFailed: failed > 0 ? mailCents(failed) : null,
  };
}

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
            ...refundAmounts(cancelled.refundTotalCents, cancelled.refundFailedCents ?? 0),
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

/** What a lifecycle action returned in `refunds`: each refund row (cents) and what Stripe did with it. */
export type IssuedRefund = { amountCents: number; status: "pending" | "succeeded" | "failed" };

/**
 * Tells the guest about a refund made outside a cancellation: an early
 * departure, a goodwill refund, or a retried refund. Says what went and what
 * Stripe refused, from what the action returned. Sends nothing when there is
 * nothing to say. After a retry only the refunds that went through are
 * mentioned: a refund that failed again was already reported as owed.
 *
 * Never throws: a failed email must not mask a refund that already happened;
 * `report` hears about it.
 */
export async function sendRefundIssued(
  bookingId: string,
  issued: { reason: RefundIssuedReason; refunds: IssuedRefund[] },
  report: (error: unknown, context: { kind: string; bookingId: string }) => void = (error) =>
    console.error("[booking-mail] refund email failed:", error instanceof Error ? error.message : error),
  deps: SendDeps = {},
): Promise<void> {
  try {
    const sum = (rows: IssuedRefund[]) => rows.reduce((total, r) => total + r.amountCents, 0);
    const counted = issued.reason === "retry" ? issued.refunds.filter((r) => r.status === "succeeded") : issued.refunds;
    const amounts = refundAmounts(sum(counted), sum(counted.filter((r) => r.status === "failed")));
    if (!amounts.refund && !amounts.refundFailed) return;

    const c = resolve(deps);
    const row = (
      await rowsOf<{ property_name: string; guestEmail: string }>(
        c.db,
        `SELECT p.name AS property_name, u.email AS "guestEmail"
           FROM bookings b
           JOIN properties p ON p.id = b.hotel_id
           JOIN "user" u ON u.id = b.user_id
          WHERE b.id = $1::uuid`,
        [bookingId],
      )
    )[0];
    if (!row) throw new Error(`Booking ${bookingId} not found for its refund email`);
    await deliver(
      c,
      [row.guestEmail],
      guestRefundIssued({ propertyName: row.property_name, reason: issued.reason, ...amounts, bookingUrl: bookingUrl(c, bookingId) }),
    );
  } catch (error) {
    try {
      report(error, { kind: `refund_${issued.reason}`, bookingId });
    } catch {
      // Reporting must not throw either.
    }
  }
}

/** What the apps' installations are called in mail, by `app_installations.app_key`. */
const APP_NAMES: Record<string, string> = { siteminder: "SiteMinder" };

/**
 * Tells the hotel (whoever gets its new-booking mail) that a booking never
 * reached its channel manager. `detail` is the app's own text, untrusted; the
 * mail shortens and escapes it. Throws on failure: the caller reports it.
 */
export async function sendChannelDeliveryFailed(bookingId: string, detail: string | null, deps: SendDeps = {}): Promise<void> {
  const c = resolve(deps);
  const row = (
    await rowsOf<{
      property_id: string;
      property_name: string;
      guestEmail: string;
      check_in_date: string;
      check_out_date: string;
      app_key: string | null;
    }>(
      c.db,
      `SELECT p.id AS property_id, p.name AS property_name, u.email AS "guestEmail",
              b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
              (SELECT ai.app_key FROM app_installations ai WHERE ai.property_id = p.id
                ORDER BY (ai.status = 'active') DESC, ai.connected_at DESC LIMIT 1) AS app_key
         FROM bookings b
         JOIN properties p ON p.id = b.hotel_id
         JOIN "user" u ON u.id = b.user_id
        WHERE b.id = $1::uuid`,
      [bookingId],
    )
  )[0];
  if (!row) throw new Error(`Booking ${bookingId} not found for its channel delivery email`);
  await deliver(
    c,
    await hostsOf(c, row.property_id, row.guestEmail),
    hostChannelDeliveryFailed({
      propertyName: row.property_name,
      reference: bookingReference(bookingId),
      appName: (row.app_key && APP_NAMES[row.app_key]) || "your channel manager",
      checkIn: row.check_in_date,
      checkOut: row.check_out_date,
      bookingUrl: reservationsUrl(c),
      detail,
    }),
  );
}
