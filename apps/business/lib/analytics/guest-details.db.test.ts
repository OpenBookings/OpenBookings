/**
 * Guest details against a real Postgres: only this hotel, only bookings made
 * in the 24-month window. query/queryOne are pointed at the test's transaction.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { mockModules } from "@/lib/mock-modules";

let db: Client;

const realDb = await import("@openbookings/db");
await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    ...realDb,
    query: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows,
    queryOne: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows[0] ?? null,
  }),
});

let queue: Promise<unknown> = Promise.resolve();
function run(text: string, values: unknown[]) {
  const result = queue.then(() => db.query(text, values));
  queue = result.catch(() => undefined);
  return result;
}

const { attachGuestDetails, guestWindow, loadGuestDetails } = await import("./guest-details");
const { loadWindowFacts } = await import("./facts-query");
const { bookingsCreatedIn } = await import("./metrics");

type Hotel = Awaited<ReturnType<typeof seedProperty>>;

describeWithDb("guest details", () => {
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
  });

  async function booked(hotel: Hotel, bookedOn: string, status = "confirmed") {
    const guest = await seedGuest(db);
    const made = await seedBooking(db, hotel, { checkIn: "2031-03-10", nights: 2, userId: guest });
    await db.query(
      `UPDATE bookings SET status = $3::booking_status, confirmed_at = $2::timestamptz WHERE id = $1`,
      [made.bookingId, `${bookedOn}T12:00:00+01:00`, status],
    );
    await db.query(`UPDATE reservations SET adults = 2, children = 1 WHERE booking_id = $1`, [made.bookingId]);
    return { ...made, guest };
  }

  test("loads details only for bookings made in the window and only for this hotel", async () => {
    const a = await seedProperty(db);
    const b = await seedProperty(db);
    const inside = await booked(a, "2031-01-15");
    await booked(a, "2028-12-01"); // before the window (today - 2 years = 2029-06-01)
    await booked(a, "2031-06-02"); // after today
    await booked(a, "2031-02-01", "pending");
    await booked(b, "2031-01-15");
    await db.query(`INSERT INTO guest_profile (user_id, country) VALUES ($1, 'NL') ON CONFLICT (user_id) DO UPDATE SET country = 'NL'`, [inside.guest]);

    const details = await loadGuestDetails(a.propertyId, "2031-06-01");
    expect(details).toEqual([
      { reservationId: inside.reservationIds[0], guestKey: inside.guest, guestCountry: "NL", adults: 2, children: 1 },
    ]);
  });

  test("a guest without a profile country is unknown", async () => {
    const a = await seedProperty(db);
    await booked(a, "2031-01-15");
    const [detail] = await loadGuestDetails(a.propertyId, "2031-06-01");
    expect(detail.guestCountry).toBe("ZZ");
  });

  test("the guest window's edges are Amsterdam days: 00:30 on the first day and 23:30 on today are in, the evening before is out", async () => {
    const a = await seedProperty(db);
    const today = "2031-06-01";
    const window = guestWindow(today); // 2029-06-01 .. 2031-06-01, both in summer time
    const at = async (instant: string) => {
      const made = await booked(a, "2031-01-15");
      await db.query(`UPDATE bookings SET confirmed_at = $2::timestamptz WHERE id = $1`, [made.bookingId, instant]);
      return made.reservationIds[0];
    };
    const first = await at("2029-05-31T22:30:00Z"); // 2029-06-01 00:30 Amsterdam
    const last = await at("2031-06-01T21:30:00Z"); // 2031-06-01 23:30 Amsterdam
    const before = await at("2029-05-31T21:30:00Z"); // 2029-05-31 23:30 Amsterdam

    const details = await loadGuestDetails(a.propertyId, today);
    expect(details.map((d) => d.reservationId).sort()).toEqual([first, last].sort());

    // The facts date those bookings on the same Amsterdam days, so the Guests page counts exactly them.
    const facts = attachGuestDetails(await loadWindowFacts(a.propertyId, window), details);
    const inWindow = bookingsCreatedIn(facts.bookings, window);
    expect(inWindow.map((b) => b.id).sort()).toEqual([first, last].sort());
    expect(inWindow.every((b) => b.hasGuestDetails)).toBe(true);
    expect(facts.bookings.find((b) => b.id === before)?.hasGuestDetails ?? false).toBe(false);
  });
});
