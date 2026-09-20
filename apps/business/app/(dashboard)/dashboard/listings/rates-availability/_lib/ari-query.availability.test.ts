/**
 * AVAILABILITY_SQL against a real Postgres.
 *
 * This is the one piece of the ARI read layer no unit test can reach. The
 * behaviour that matters is not in TypeScript at all — it is in a sparse LEFT
 * JOIN, a generated date spine, a half-open range predicate and a status
 * filter. Mocking the driver would only assert that the string we wrote is the
 * string we wrote.
 *
 * The connection is the ephemeral database CI already provisions (see
 * .github/workflows/ci.yml and packages/db/scripts/apply-schema-ci.ts). Every
 * test runs inside a transaction that is rolled back, so the suite leaves
 * nothing behind and the cases cannot see each other.
 *
 * Scope note: this covers what the SQL itself decides. The precedence rule —
 * `available_override ?? computed` — lives in `loadAriGrid`, not in the query;
 * the query only has to surface the column faithfully, which is asserted here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { AVAILABILITY_SQL } from "./ari-query";

const connectionString = process.env.DATABASE_URL;

// In CI a missing DATABASE_URL is a broken pipeline, not a reason to pass: the
// Verify job sets it and provisions the schema. Locally, skip with a pointer
// rather than failing a developer who has no database running.
if (!connectionString && process.env.CI) {
  throw new Error(
    "DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.",
  );
}

const describeWithDb = connectionString ? describe : describe.skip;

if (!connectionString) {
  console.warn(
    "[ari-query.availability] DATABASE_URL not set — skipping. To run these:\n" +
      "  docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgis/postgis:17-3.5-alpine\n" +
      "  cd packages/db && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun run db:setup:ci",
  );
}

interface AvailabilityRow {
  room_id: string;
  room_name: string;
  total_units: number;
  date: string;
  effective_total: number;
  booked: number;
  blocked: number;
  available_override: number | null;
  note: string | null;
}

/** The window every test queries. Fixed, so nothing depends on today's date. */
const RANGE_START = "2031-03-09";
const RANGE_END = "2031-03-13";

describeWithDb("AVAILABILITY_SQL", () => {
  let db: Client;

  /** Set by the fixture, read by the assertions. */
  let ownerUserId: string;
  let propertyId: string;
  let roomId: string;
  let ratePlanId: string;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await db.query("BEGIN");

    ownerUserId = `test-host-${crypto.randomUUID()}`;

    // `location` is geography(Point, 4326) — the reason CI runs PostGIS and not
    // stock postgres. The coordinates are arbitrary; nothing here reads them.
    const property = await db.query<{ id: string }>(
      `INSERT INTO properties
         (name, slug, address_line_1, city, country, timezone, location,
          check_in_time, check_out_time, owner_user_id, is_active)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326),
               '15:00', '11:00', $2, true)
       RETURNING id`,
      [`test-property-${crypto.randomUUID()}`, ownerUserId],
    );
    propertyId = property.rows[0].id;

    // total_units 5: big enough that booked/blocked/override are all
    // distinguishable from the capacity they are subtracted from.
    const room = await db.query<{ id: string }>(
      `INSERT INTO rooms
         (property_id, name, base_occupancy, max_adults, total_units, is_active, room_type)
       VALUES ($1, 'Double', 2, 2, 5, true, 'double')
       RETURNING id`,
      [propertyId],
    );
    roomId = room.rows[0].id;

    // reservations.rate_plan_id is NOT NULL, so a plan has to exist even though
    // availability is a room-type fact and never reads it.
    const ratePlan = await db.query<{ id: string }>(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable)
       VALUES ($1, 'Standard', 10000, true)
       RETURNING id`,
      [roomId],
    );
    ratePlanId = ratePlan.rows[0].id;
  });

  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function rows(): Promise<AvailabilityRow[]> {
    const result = await db.query<AvailabilityRow>(AVAILABILITY_SQL, [
      ownerUserId,
      propertyId,
      RANGE_START,
      RANGE_END,
    ]);
    return result.rows;
  }

  function on(all: AvailabilityRow[], date: string): AvailabilityRow {
    const row = all.find((r) => r.date === date);
    if (!row) throw new Error(`no row for ${date}; got ${all.map((r) => r.date).join(", ")}`);
    return row;
  }

  /** A booking plus one reservation against the room, in the given status. */
  async function book(
    status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show",
    checkIn: string,
    checkOut: string,
    units = 1,
  ): Promise<void> {
    const booking = await db.query<{ id: string }>(
      `INSERT INTO bookings
         (hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
       VALUES ($1, $2, $3, $4, $5::booking_status, 10000)
       RETURNING id`,
      [propertyId, `guest-${crypto.randomUUID()}`, checkIn, checkOut, status],
    );

    for (let i = 0; i < units; i += 1) {
      await db.query(
        `INSERT INTO reservations
           (booking_id, room_id, rate_plan_id, total_nights, price_per_night, total_amount)
         VALUES ($1, $2, $3, 1, 10000, 10000)`,
        [booking.rows[0].id, roomId, ratePlanId],
      );
    }
  }

  test("returns one row per date across the whole window, inclusive of both ends", async () => {
    const all = await rows();

    expect(all.map((r) => r.date)).toEqual([
      "2031-03-09",
      "2031-03-10",
      "2031-03-11",
      "2031-03-12",
      "2031-03-13",
    ]);
  });

  test("falls back to rooms.total_units on dates with no room_inventory row", async () => {
    // The sparse-join case, and the common one: most dates have no override row
    // at all. A plain JOIN here would drop every date instead.
    const all = await rows();

    for (const row of all) {
      expect(row.effective_total).toBe(5);
      expect(row.total_units).toBe(5);
      expect(row.blocked).toBe(0);
      expect(row.available_override).toBeNull();
      expect(row.booked).toBe(0);
    }
  });

  test("a room_inventory row overrides capacity and surfaces blocked units and the override", async () => {
    await db.query(
      `INSERT INTO room_inventory
         (room_id, date, total_rooms, blocked_rooms, available_override, note)
       VALUES ($1, '2031-03-11', 4, 1, 2, 'partial refurb')`,
      [roomId],
    );

    const all = await rows();

    const overridden = on(all, "2031-03-11");
    expect(overridden.effective_total).toBe(4); // inv.total_rooms, not rooms.total_units
    expect(overridden.blocked).toBe(1);
    expect(overridden.available_override).toBe(2);
    expect(overridden.note).toBe("partial refurb");

    // Its neighbours are untouched — the join is per-date, not per-range.
    expect(on(all, "2031-03-10").effective_total).toBe(5);
    expect(on(all, "2031-03-10").available_override).toBeNull();
  });

  test("counts a booking on its arrival night but not its departure night", async () => {
    // The half-open range: `d >= check_in AND d < check_out`. A guest arriving
    // the 10th and leaving the 12th occupies the 10th and 11th. Counting the
    // 12th would suppress a night that is genuinely sellable.
    await book("confirmed", "2031-03-10", "2031-03-12");

    const all = await rows();

    expect(on(all, "2031-03-09").booked).toBe(0); // night before arrival
    expect(on(all, "2031-03-10").booked).toBe(1); // arrival night — counted
    expect(on(all, "2031-03-11").booked).toBe(1);
    expect(on(all, "2031-03-12").booked).toBe(0); // departure night — not counted
    expect(on(all, "2031-03-13").booked).toBe(0);
  });

  test("counts only bookings that hold stock, so a pending booking does not suppress availability", async () => {
    // Deliberate, and documented on the query: an unpaid hold showing up as
    // booked would tell a host they have less to sell than they do. It is also
    // an oversell window, which is why it is pinned down by a test rather than
    // left to be rediscovered.
    await book("pending", "2031-03-10", "2031-03-11");
    await book("cancelled", "2031-03-10", "2031-03-11");
    await book("no_show", "2031-03-10", "2031-03-11");

    expect(on(await rows(), "2031-03-10").booked).toBe(0);

    await book("confirmed", "2031-03-10", "2031-03-11");
    expect(on(await rows(), "2031-03-10").booked).toBe(1);

    await book("completed", "2031-03-10", "2031-03-11");
    expect(on(await rows(), "2031-03-10").booked).toBe(2);
  });

  test("counts units, not bookings, when one booking takes several of the same room", async () => {
    await book("confirmed", "2031-03-10", "2031-03-11", 3);

    expect(on(await rows(), "2031-03-10").booked).toBe(3);
  });

  test("returns nothing for a property the caller does not own", async () => {
    // $1 is the verified owner id injected by getHostScopedDb. This asserts the
    // predicate is actually load-bearing, not that authz works.
    const result = await db.query<AvailabilityRow>(AVAILABILITY_SQL, [
      "some-other-host",
      propertyId,
      RANGE_START,
      RANGE_END,
    ]);

    expect(result.rows).toHaveLength(0);
  });

  test("excludes inactive rooms", async () => {
    await db.query(`UPDATE rooms SET is_active = false WHERE id = $1`, [roomId]);

    expect(await rows()).toHaveLength(0);
  });
});
