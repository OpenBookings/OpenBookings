/**
 * The core half of the SiteMinder end-to-end check (apps/siteminder/scripts/e2e-local.ts runs it; the SiteMinder
 * app may not import core packages, so its core-side steps live here). One command per run, its input as JSON,
 * one `E2E_RESULT {json}` line on stdout:
 *
 *   bun scripts/siteminder-e2e-core.ts connect    '{"propertyId","roomId","ratePlanId","ownerEmail"}'
 *   bun scripts/siteminder-e2e-core.ts units      '{"propertyId","roomId","checkIn","checkOut"}'
 *   bun scripts/siteminder-e2e-core.ts status     '{"propertyId","uniqueId"}'
 *   bun scripts/siteminder-e2e-core.ts cancel     '{"bookingId","ownerEmail"}'
 *   bun scripts/siteminder-e2e-core.ts disconnect '{"propertyId","ownerEmail"}'
 *
 * Connect and disconnect go through the Channel manager's own functions (connect.ts) as the hotel's owner, with
 * the session's current-hotel pin set to the property. Cancel is the host's "Cancel booking" minus the emails.
 *
 * It writes to the database the business app uses, so it refuses any database that is not on localhost, read the
 * way `@openbookings/db` picks it (ENV_TYPE=dev → DEV_DATABASE_URL). Run from apps/business.
 */
import { assertLocalDatabase } from "../../siteminder/scripts/local-db";

const MARKER = "E2E_RESULT ";

const usesDev = process.env.ENV_TYPE === "dev";
assertLocalDatabase(usesDev ? "DEV_DATABASE_URL" : "DATABASE_URL", usesDev ? process.env.DEV_DATABASE_URL : process.env.DATABASE_URL);

// Imported after the check: @openbookings/db builds its pool from the environment when it loads.
const { getPool, loadStayAvailability, queryOne } = await import("@openbookings/db");
const { cancelRooms } = await import("@openbookings/db/booking-lifecycle");
const { deliveryForBooking, doorbellFromEnv, notifyBookingChanged } = await import("@openbookings/db/apps");
const { todayInZone } = await import("@openbookings/pricing");
const { findRefundForRow, isDefiniteRefundFailure, refundPayment } = await import("@openbookings/stripe");
const { deliveryBadge } = await import("../lib/apps/managed-view");
const { connectChannelManager, defaultDeps, disconnectChannelManager } = await import(
  "../app/(dashboard)/dashboard/listings/channel-manager/_lib/connect"
);

type Input = Record<string, unknown>;

function need(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`missing "${key}"`);
  return value;
}

async function owner(email: string) {
  const row = await queryOne<{ id: string }>(`SELECT id FROM "user" WHERE lower(email) = lower($1)`, [email]);
  if (!row) throw new Error(`no user ${email}`);
  return { user: { id: row.id, account_type: "business" } };
}

/** The connect deps, with the session's current hotel pinned to this property (there is no browser cookie). */
const pinnedTo = (propertyId: string) => ({ ...defaultDeps, pin: async () => ({ currentPropertyId: propertyId }) });

const commands: Record<string, (input: Input) => Promise<unknown>> = {
  async connect(input) {
    const propertyId = need(input, "propertyId");
    const session = await owner(need(input, "ownerEmail"));
    // A run that stopped half way can leave the hotel connected; start from a clean slate.
    await disconnectChannelManager(session, { propertyId }, pinnedTo(propertyId));
    const result = await connectChannelManager(session, { propertyId, sendUpcoming: false }, pinnedTo(propertyId));
    if (!result.ok) throw new Error(`connect refused: ${result.error}`);
    const row = await queryOne<Record<string, string>>(
      `SELECT p.channel_code AS "propertyCode", p.slug, p.timezone,
              r.channel_code AS "roomCode", r.name AS "roomName",
              rp.channel_code AS "rateCode", rp.name AS "rateName"
         FROM properties p
         JOIN rooms r ON r.property_id = p.id AND r.id = $2::uuid
         JOIN rate_plans rp ON rp.room_id = r.id AND rp.id = $3::uuid
        WHERE p.id = $1::uuid`,
      [propertyId, need(input, "roomId"), need(input, "ratePlanId")],
    );
    if (!row) throw new Error("room or rate plan not found at that property");
    return { ...row, today: todayInZone(row.timezone!) };
  },

  async units(input) {
    const roomId = need(input, "roomId");
    const checkIn = need(input, "checkIn");
    const checkOut = need(input, "checkOut");
    const rooms = await loadStayAvailability(getPool(), { propertyId: need(input, "propertyId"), checkIn, checkOut, now: new Date() });
    const room = rooms.find((r) => r.roomId === roomId);
    if (!room) throw new Error("room not found");
    const limits = await getPool().query(
      `SELECT date::text AS date, units_left FROM app_inventory WHERE room_id = $1::uuid AND date >= $2::date AND date < $3::date`,
      [roomId, checkIn, checkOut],
    );
    const limitOf = new Map((limits.rows as { date: string; units_left: number }[]).map((r) => [r.date, r.units_left]));
    return {
      onSale: room.onSale,
      nights: room.nights.map((n) => ({ ...n, limit: limitOf.get(n.date) ?? null })),
    };
  },

  async status(input) {
    const propertyId = need(input, "propertyId");
    const head = need(input, "uniqueId").toUpperCase().replace(/^OB/, "");
    const booking = await queryOne<{ id: string; status: string; timezone: string }>(
      `SELECT b.id, b.status, p.timezone FROM bookings b JOIN properties p ON p.id = b.hotel_id
        WHERE b.hotel_id = $1::uuid AND upper(left(b.id::text, 8)) = $2`,
      [propertyId, head],
    );
    if (!booking) return null;
    const delivery = await deliveryForBooking(getPool(), booking.id, { propertyId });
    return { bookingId: booking.id, bookingStatus: booking.status, delivery, badge: deliveryBadge(delivery, booking.timezone) };
  },

  async cancel(input) {
    const bookingId = need(input, "bookingId");
    const session = await owner(need(input, "ownerEmail"));
    const result = await cancelRooms(
      { refund: refundPayment, isDefiniteFailure: isDefiniteRefundFailure, findRefund: findRefundForRow },
      { bookingId, actor: { kind: "host", userId: session.user.id }, reservationIds: null },
    );
    const ring = doorbellFromEnv(process.env);
    if (result.ok && ring) await notifyBookingChanged(getPool(), bookingId, { ring });
    return result;
  },

  async disconnect(input) {
    const propertyId = need(input, "propertyId");
    return disconnectChannelManager(await owner(need(input, "ownerEmail")), { propertyId }, pinnedTo(propertyId));
  },
};

const [name = "", json = "{}"] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`usage: bun scripts/siteminder-e2e-core.ts <${Object.keys(commands).join("|")}> '<json>'`);
  process.exit(2);
}
try {
  console.log(MARKER + JSON.stringify(await command(JSON.parse(json) as Input)));
} finally {
  await getPool().end();
}
