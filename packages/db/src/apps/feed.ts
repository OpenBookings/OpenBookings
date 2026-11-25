/**
 * The booking change feed (spec §1 "Booking change feed", §3b): how a connected
 * app learns about its property's bookings. Read by the Apps API.
 *
 * A page carries each changed booking's full current state, never a diff, so
 * an app that sees a booking twice just keeps the higher `version`. Guest data
 * is first and last name only: this module never selects email, phone,
 * address, `guest_profile` or `guest_notes`.
 *
 * ## Cursor and ordering
 *
 * The cursor is `"<txid>:<seq>"`, a position in `booking_events` ordered by
 * (txid, seq) (0060): `txid` is the writing transaction's 64-bit xid8, `seq` an
 * identity value taken at INSERT time. A page reads only events with
 * `txid < finishedBefore`, where `finishedBefore` is the xmin of a snapshot
 * taken before the scan, `pg_snapshot_xmin(pg_current_snapshot())`.
 *
 * Why nothing is skipped although transactions commit in any order and `seq`
 * follows insert order, not commit order:
 *
 *   1. Every transaction with an xid below a snapshot's xmin has finished
 *      (committed or aborted), and xids are handed out in increasing order, so
 *      no transaction below xmin can ever write another event. The set of
 *      events with txid < xmin is final: later reads see exactly the same rows.
 *   2. A transaction still running holds an xid >= xmin of every snapshot taken
 *      while it runs (Postgres's own MVCC rests on this), so its events, and the
 *      events of any transaction that starts later, are never below the bound.
 *   3. A page walks that final set in (txid, seq) order from the cursor, and the
 *      next cursor never passes an event it did not walk. Ordering primarily by
 *      txid is what makes "below the bound" a prefix: an older transaction that
 *      inserted early (low seq) but commits late is only read once its txid
 *      falls below xmin, i.e. after it finished, and it then sorts before every
 *      younger transaction's events regardless of seq.
 *
 * So no event can appear later at a position behind a cursor already handed
 * out. Events of the reading transaction itself are never below its own xmin;
 * tests use `loadBookingChangesBefore` with an explicit bound for that reason.
 * (The feed must read the primary: a lagging replica's snapshot is behind.)
 *
 * Only delivery-relevant events count (R10: check-in, no-show and refund events
 * are not sent to the channel). A booking is in a page when it has such an
 * event after the cursor; `version` is the max `seq` of its delivery-relevant
 * events. Every writer of those events locks the booking row first (lifecycle
 * FOR UPDATE, admin forced edits FOR UPDATE, confirmation's UPDATE), so a
 * booking's events get seq in commit order and the highest seq belongs to the
 * newest state.
 */
import type { AppBooking, AppBookingRoom, BookingChangesPage } from "@openbookings/apps-contract";
import { todayInZone } from "@openbookings/pricing";
import { roundHalfUp } from "@openbookings/pricing/money";
import { bookingReference } from "../booking-reference";
import type { BookingEventKind } from "../booking-events";
import type { Queryable } from "../reservation-policy";
import { upcomingBookings, type Installation } from "./installations";
import { appName } from "./names";

/**
 * Booking event kinds an app is told about. 0060's `app_delivery_booking_changed`
 * trigger lists the same kinds (keep them in step): one of them puts a
 * delivered booking back to `pending`.
 */
export const DELIVERY_EVENT_KINDS = [
  "confirmed",
  "rooms_cancelled",
  "early_departure",
  "forced_status",
  "forced_uncancel",
  "forced_cancel",
  "forced_markers_cleared",
] as const satisfies readonly BookingEventKind[];

export class InvalidFeedCursorError extends Error {
  constructor(cursor: string) {
    super(`Invalid booking feed cursor ${JSON.stringify(cursor)}: expected "<txid>:<seq>"`);
    this.name = "InvalidFeedCursorError";
  }
}

type Position = { txid: bigint; seq: bigint };

const XID8_MAX = BigInt("18446744073709551615"); // 2^64 - 1
const BIGINT_MAX = BigInt("9223372036854775807"); // 2^63 - 1

function parseCursor(cursor: string): Position {
  const m = /^(\d{1,20}):(\d{1,19})$/.exec(cursor);
  if (!m) throw new InvalidFeedCursorError(cursor);
  const txid = BigInt(m[1]!);
  const seq = BigInt(m[2]!);
  if (txid > XID8_MAX || seq > BIGINT_MAX) throw new InvalidFeedCursorError(cursor);
  return { txid, seq };
}

const formatCursor = (p: Position) => `${p.txid}:${p.seq}`;
const after = (a: Position, b: Position) => a.txid > b.txid || (a.txid === b.txid && a.seq > b.seq);

/** Booking changes after `cursor` (or, with `cursor: null`, the snapshot of upcoming bookings). */
export async function loadBookingChanges(
  db: Queryable,
  installation: Installation,
  i: { cursor: string | null; limit: number },
): Promise<BookingChangesPage> {
  // Taken before anything is read (see the module comment): a bound from an
  // older snapshot only makes the page smaller, never skips anything.
  const bound = (await db.query(`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`)).rows[0] as {
    xmin: string;
  };
  return loadBookingChangesBefore(db, installation, i, bound.xmin);
}

/**
 * `loadBookingChanges` with the bound passed in: only transactions with a
 * txid below `finishedBefore` are read. Production code calls
 * `loadBookingChanges`; tests pass their own txid + 1 here.
 */
export async function loadBookingChangesBefore(
  db: Queryable,
  installation: Installation,
  i: { cursor: string | null; limit: number },
  finishedBefore: string,
): Promise<BookingChangesPage> {
  const bound = BigInt(finishedBefore);
  if (i.cursor === null) return snapshot(db, installation, bound);

  const cursor = parseCursor(i.cursor);
  const limit = Math.max(1, Math.floor(i.limit));

  // The installation's relevant events in (cursor, bound), minus bookings the
  // hotel chose not to send (§3b: their later changes are not sent either).
  const relevant = `
    SELECT e.booking_id, e.txid, e.seq
      FROM booking_events e
      JOIN bookings b ON b.id = e.booking_id
     WHERE b.hotel_id = $1::uuid
       AND e.kind = ANY ($2::text[])
       AND (e.txid, e.seq) > ($3::xid8, $4::bigint)
       AND e.txid < $5::xid8
       AND NOT EXISTS (
         SELECT 1 FROM app_booking_delivery d
          WHERE d.installation_id = $6::uuid AND d.booking_id = e.booking_id AND d.status = 'not_sent'
       )`;
  const params = [
    installation.propertyId,
    DELIVERY_EVENT_KINDS,
    cursor.txid.toString(),
    cursor.seq.toString(),
    bound.toString(),
    installation.id,
  ];

  // Bookings in order of their first event after the cursor; one more than
  // the limit tells whether there is more.
  const firsts = (
    await db.query(
      `WITH ev AS (${relevant}),
            firsts AS (SELECT DISTINCT ON (booking_id) booking_id, txid, seq FROM ev ORDER BY booking_id, txid, seq)
       SELECT booking_id, txid::text AS t, seq::text AS s FROM firsts ORDER BY firsts.txid, firsts.seq LIMIT $7`,
      [...params, limit + 1],
    )
  ).rows as { booking_id: string; t: string; s: string }[];

  const page = firsts.slice(0, limit);
  const bookings = await loadBookings(db, installation.propertyId, page.map((r) => r.booking_id));

  if (firsts.length > limit) {
    // More to come. Stop just before the first event of the first booking left
    // out: every event up to there belongs to a booking in this page. A booking
    // in this page with a later event comes again on the next page (same full
    // state or newer); its version tells the app.
    const next = firsts[limit]!;
    const last = (
      await db.query(
        `WITH ev AS (${relevant})
         SELECT ev.txid::text AS t, ev.seq::text AS s FROM ev
          WHERE (ev.txid, ev.seq) < ($7::xid8, $8::bigint)
          ORDER BY ev.txid DESC, ev.seq DESC LIMIT 1`,
        [...params, next.t, next.s],
      )
    ).rows[0] as { t: string; s: string };
    return { bookings, nextCursor: formatCursor({ txid: BigInt(last.t), seq: BigInt(last.s) }), hasMore: true };
  }

  // Everything below the bound has been walked: move the cursor to the last
  // event below it, whatever its property or kind, so a quiet property does
  // not rescan other properties' events on every poll.
  const top = (
    await db.query(
      `SELECT e.txid::text AS t, e.seq::text AS s FROM booking_events e
        WHERE e.txid < $1::xid8 ORDER BY e.txid DESC, e.seq DESC LIMIT 1`,
      [bound.toString()],
    )
  ).rows[0] as { t: string; s: string } | undefined;
  const topPosition = top && { txid: BigInt(top.t), seq: BigInt(top.s) };
  const nextCursor = topPosition && after(topPosition, cursor) ? topPosition : cursor;
  return { bookings, nextCursor: formatCursor(nextCursor), hasMore: false };
}

/**
 * §3b: upcoming bookings (confirmed or checked in, check-out today or later at
 * the property) except those the hotel chose not to send, all in one page. The
 * next cursor starts at the bound: a change committed while the snapshot was
 * read comes again through the feed, never goes missing.
 */
async function snapshot(db: Queryable, installation: Installation, bound: bigint): Promise<BookingChangesPage> {
  const property = (await db.query(`SELECT timezone FROM properties WHERE id = $1::uuid`, [installation.propertyId]))
    .rows[0] as { timezone: string } | undefined;
  if (!property) return { bookings: [], nextCursor: formatCursor({ txid: bound, seq: BigInt(0) }), hasMore: false };
  const ids = (
    await db.query(
      `SELECT u.id FROM (${upcomingBookings("$1", "$2")}) u
        WHERE NOT EXISTS (
          SELECT 1 FROM app_booking_delivery d
           WHERE d.installation_id = $3::uuid AND d.booking_id = u.id AND d.status = 'not_sent'
        )`,
      [installation.propertyId, todayInZone(property.timezone), installation.id],
    )
  ).rows as { id: string }[];
  const bookings = await loadBookings(db, installation.propertyId, ids.map((r) => r.id));
  bookings.sort((a, b) => (a.checkIn === b.checkIn ? (a.bookingId < b.bookingId ? -1 : 1) : a.checkIn < b.checkIn ? -1 : 1));
  return { bookings, nextCursor: formatCursor({ txid: bound, seq: BigInt(0) }), hasMore: false };
}

type BookingRow = {
  id: string;
  status: string;
  check_in: string;
  check_out: string;
  created_at: Date;
  modified_at: Date;
  version: string;
  rooms_total_cents: string;
  total_cents: string;
  commission_cents: string;
  room_price_refunded_cents: string;
  disputed_cents: string;
  first_name: string;
  last_name: string;
};

type ReservationRow = {
  id: string;
  booking_id: string;
  room_code: string;
  rate_plan_code: string;
  adults: number;
  children: number;
  infants: number;
  cots: number;
  extra_beds: number;
  cancelled: boolean;
  nights: { date: string; priceCents: number; touristTaxCents?: number }[];
  tourist_tax_cents: string;
  pay_at_property_cents: string;
};

/**
 * The commission OpenBookings keeps now: the fee charged less what refunds
 * gave back, following the refund model (2026-11-20): in proportion to the
 * room price refunded through OpenBookings, and for a lost dispute to the
 * whole payment; refunds made outside OpenBookings give nothing back. Rounded
 * down per part, never below zero, like `commissionRefundDue`
 * (@openbookings/stripe), which settles the actual fee refunds with Stripe.
 */
function commissionKept(b: BookingRow): number {
  const fee = BigInt(b.commission_cents);
  const share = (part: string, whole: string) =>
    BigInt(whole) > BigInt(0) ? (fee * BigInt(part)) / BigInt(whole) : BigInt(0);
  const back = share(b.room_price_refunded_cents, b.rooms_total_cents) + share(b.disputed_cents, b.total_cents);
  return Number(back >= fee ? BigInt(0) : fee - back);
}

/**
 * Full current state of the given bookings of one property, in the order given.
 *
 * Money is what the booking is worth now (R14): nights after an early
 * departure are left out of each room (with their tourist tax and cots/extra
 * beds, which are charged per night), and the booking totals count only rooms
 * not cancelled. Cancelled rooms still list their nights, for the app's record.
 */
async function loadBookings(db: Queryable, propertyId: string, ids: string[]): Promise<AppBooking[]> {
  if (ids.length === 0) return [];
  // The stay ends the day after the last night stayed when the guest left early.
  const bookingRows = (
    await db.query(
      `SELECT b.id, b.status::text AS status,
              b.check_in_date::text AS check_in,
              LEAST(b.check_out_date, COALESCE(b.departed_early_on + 1, b.check_out_date))::text AS check_out,
              COALESCE(b.confirmed_at, b.created_at) AS created_at,
              COALESCE(ev.modified_at, b.confirmed_at, b.created_at) AS modified_at,
              COALESCE(ev.version, 0)::text AS version,
              b.rooms_total_cents::text AS rooms_total_cents,
              b.total_cents::text AS total_cents,
              b.commission_cents::text AS commission_cents,
              rf.room_price_refunded_cents::text AS room_price_refunded_cents,
              rf.disputed_cents::text AS disputed_cents,
              COALESCE(u.first_name, '') AS first_name, COALESCE(u.last_name, '') AS last_name
         FROM bookings b
         -- A booking outlives its guest's account: no account, no name ("Guest", see appName).
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN LATERAL (
           SELECT max(e.seq) AS version, max(e.created_at) AS modified_at
             FROM booking_events e
            WHERE e.booking_id = b.id AND e.kind = ANY ($3::text[])
         ) ev ON true
         CROSS JOIN LATERAL (
           SELECT COALESCE(sum(f.accommodation_cents) FILTER (WHERE f.source = 'openbookings'), 0) AS room_price_refunded_cents,
                  COALESCE(sum(f.amount_cents) FILTER (WHERE f.source = 'dispute'), 0) AS disputed_cents
             FROM refunds f
            WHERE f.booking_id = b.id AND f.status <> 'failed'
         ) rf
        WHERE b.id = ANY ($1::uuid[]) AND b.hotel_id = $2::uuid`,
      [ids, propertyId, DELIVERY_EVENT_KINDS],
    )
  ).rows as BookingRow[];

  const reservationRows = (
    await db.query(
      `SELECT r.id, r.booking_id, rm.channel_code AS room_code, rp.channel_code AS rate_plan_code,
              r.adults, r.children, r.infants::int AS infants, r.cots::int AS cots, r.extra_beds::int AS extra_beds,
              r.cancelled_at IS NOT NULL AS cancelled, r.nights,
              r.tourist_tax_cents::text AS tourist_tax_cents,
              r.pay_at_property_cents::text AS pay_at_property_cents
         FROM reservations r
         JOIN rooms rm ON rm.id = r.room_id
         JOIN rate_plans rp ON rp.id = r.rate_plan_id
        WHERE r.booking_id = ANY ($1::uuid[])
        ORDER BY r.created_at, r.id`,
      [ids],
    )
  ).rows as ReservationRow[];

  const roomsByBooking = new Map<string, ReservationRow[]>();
  for (const r of reservationRows) {
    const list = roomsByBooking.get(r.booking_id) ?? [];
    list.push(r);
    roomsByBooking.set(r.booking_id, list);
  }

  const room = (b: BookingRow, cancelled: boolean, r: ReservationRow): AppBookingRoom => {
    // YYYY-MM-DD strings compare as dates; nights after an early departure are not stayed.
    const stayed = r.nights.filter((n) => n.date >= b.check_in && n.date < b.check_out);
    // Nights from before the policy snapshot (0027) are unknown: keep the stored amounts.
    const known = r.nights.length > 0;
    return {
      reservationId: r.id,
      roomCode: r.room_code,
      ratePlanCode: r.rate_plan_code,
      checkIn: b.check_in,
      checkOut: b.check_out,
      adults: r.adults,
      children: r.children,
      infants: r.infants,
      cots: r.cots,
      extraBeds: r.extra_beds,
      // A booking cancelled as a whole (e.g. an admin's forced status) may leave rooms unmarked.
      cancelled: cancelled || r.cancelled,
      nights: stayed.map((n) => ({ date: n.date, priceCents: n.priceCents })),
      touristTaxCents: known
        ? stayed.reduce((sum, n) => sum + (n.touristTaxCents ?? 0), 0)
        : Number(r.tourist_tax_cents),
      // Cots and extra beds cost the same every night (calculator payAtPropertyLines).
      payAtPropertyCents: known
        ? roundHalfUp((Number(r.pay_at_property_cents) * stayed.length) / r.nights.length)
        : Number(r.pay_at_property_cents),
    };
  };

  const byId = new Map(
    bookingRows.map((b): [string, AppBooking] => {
      const cancelled = b.status === "cancelled";
      const rooms = (roomsByBooking.get(b.id) ?? []).map((r) => room(b, cancelled, r));
      const open = rooms.filter((r) => !r.cancelled);
      return [
        b.id,
        {
          bookingId: b.id,
          reference: bookingReference(b.id),
          version: Number(b.version),
          cancelled,
          createdAt: b.created_at.toISOString(),
          modifiedAt: b.modified_at.toISOString(),
          checkIn: b.check_in,
          checkOut: b.check_out,
          booker: appName(b.first_name, b.last_name),
          rooms,
          roomsTotalCents: open.reduce((sum, r) => sum + r.nights.reduce((s, n) => s + n.priceCents, 0), 0),
          touristTaxCents: open.reduce((sum, r) => sum + r.touristTaxCents, 0),
          commissionCents: commissionKept(b),
        },
      ];
    }),
  );
  return ids.flatMap((id) => byId.get(id) ?? []);
}
