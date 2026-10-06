/**
 * The Rooms editor's writes and reads against a real Postgres.
 *
 * mutations.test.ts proves every mutation asks authz first. This proves the
 * SQL behind the rules: the units floor computed from future nights, the
 * archive guards, the activation rules, org-membership access through the
 * real PROPERTY_EDIT_ACCESS_SQL, and the loaders. None of that is in
 * TypeScript, so a fake database could only echo it back.
 *
 * Same harness as the R&A suites: a throwaway Neon branch in CI, every test
 * inside a transaction that is rolled back, skipped locally without
 * DATABASE_URL. Fixture dates sit in 2031 so "future" never depends on today.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import type { SessionLike } from "@openbookings/authz";
import { applyPendingMigrations } from "../../_lib/pending-migrations";
import * as m from "./mutations";
import { loadRoomEditor, loadRoomsIndex } from "./query";

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.CI) {
  throw new Error(
    "DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.",
  );
}

const describeWithDb = connectionString ? describe : describe.skip;

const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value);
  }
  return fd;
}

describeWithDb("Rooms editor against Postgres", () => {
  let db: Client;
  let deps: m.MutationDeps;

  let owner: string;
  let stranger: string;
  let orgAdmin: string;
  let guest: string;
  let propertyId: string;
  let roomId: string;
  /** Priced (bar > 0) and active. */
  let pricedRate: string;
  /** Unpriced (bar = 0) and inactive, as the Rooms editor creates them. */
  let unpricedRate: string;

  const one = async <T,>(sql: string, values: unknown[] = []) =>
    ((await db.query(sql, values)).rows[0] ?? null) as T | null;
  const many = async <T,>(sql: string, values: unknown[] = []) =>
    (await db.query(sql, values)).rows as T[];

  /** getHostScopedDb's shape, bound to this transaction. */
  const hostDb = (s: SessionLike) => ({
    query: <T,>(sql: string, values: unknown[] = []) => many<T>(sql, [s.user.id, ...values]),
    queryOne: <T,>(sql: string, values: unknown[] = []) => one<T>(sql, [s.user.id, ...values]),
  });

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
    deps = {
      query: many,
      queryOne: one,
      // Nested inside the test's own transaction, so a savepoint stands in.
      transaction: async (fn) => {
        await db.query("SAVEPOINT mutation");
        try {
          const result = await fn({ query: many, queryOne: one });
          await db.query("RELEASE SAVEPOINT mutation");
          return result;
        } catch (error) {
          await db.query("ROLLBACK TO SAVEPOINT mutation");
          throw error;
        }
      },
      purge: async () => {},
      loadRoom: (s, id) => loadRoomEditor(s, id, hostDb(s)),
    };
  });

  afterAll(async () => {
    await db.end();
  });

  async function createUser(accountType: "private" | "business"): Promise<string> {
    const id = `test-${accountType}-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, $2, $3, true, $4::account_type)`,
      [id, `Test ${accountType}`, `${id}@example.test`, accountType],
    );
    return id;
  }

  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);

    owner = await createUser("business");
    stranger = await createUser("business");
    orgAdmin = await createUser("business");
    guest = await createUser("private");

    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, NOW())`,
      [orgId],
    );
    await db.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ($1, $2, $3, 'admin', NOW())`,
      [`test-member-${crypto.randomUUID()}`, orgId, orgAdmin],
    );

    propertyId = (await one<{ id: string }>(
      `INSERT INTO properties
         (name, slug, address_line_1, city, country, timezone, location,
          check_in_time, check_out_time, owner_user_id, organization_id, is_active)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326),
               '15:00', '11:00', $2, $3, true)
       RETURNING id`,
      [`test-property-${crypto.randomUUID()}`, owner, orgId],
    ))!.id;

    roomId = (await one<{ id: string }>(
      `INSERT INTO rooms
         (property_id, name, base_occupancy, max_adults, total_units, is_active, amenity_keys)
       VALUES ($1, 'Deluxe King', 2, 2, 3, false, '{}')
       RETURNING id`,
      [propertyId],
    ))!.id;

    pricedRate = (await one<{ id: string }>(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active, currency, extras)
       VALUES ($1, 'Standard', 12000, true, true, 'EUR', '{parking}')
       RETURNING id`,
      [roomId],
    ))!.id;

    unpricedRate = (await one<{ id: string }>(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active)
       VALUES ($1, 'New', 0, false, false)
       RETURNING id`,
      [roomId],
    ))!.id;
  });

  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function book(
    status: "pending" | "confirmed" | "cancelled",
    checkIn: string,
    checkOut: string,
    units = 1,
    ratePlanId = pricedRate,
  ) {
    const booking = await one<{ id: string }>(
      `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
       VALUES ($1, $2, $3, $4, $5::booking_status, 10000)
       RETURNING id`,
      [propertyId, guest, checkIn, checkOut, status],
    );
    for (let i = 0; i < units; i += 1) {
      await db.query(
        `INSERT INTO reservations
           (booking_id, room_id, rate_plan_id, total_nights, price_per_night, total_amount)
         VALUES ($1, $2, $3, 1, 10000, 10000)`,
        [booking!.id, roomId, ratePlanId],
      );
    }
    return booking!.id;
  }

  const spaceForm = (units: string) =>
    form({ roomId, sizeM2: "35", maxAdults: "2", maxChildren: "1", units, bed_king: "1", bed_sofa_bed: "1" });

  // ── Access ──────────────────────────────────────────────────────────

  test("an org admin who is not the legacy owner can edit", async () => {
    const state = await m.saveRoomIdentity(
      session(orgAdmin),
      form({ roomId, name: "Garden Suite", description: "x".repeat(50) }),
      deps,
    );
    expect(state.success).toBe(true);
    expect((await one<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [roomId]))!.name).toBe(
      "Garden Suite",
    );
  });

  test("a host from outside the organisation cannot, and nothing changes", async () => {
    await expect(
      m.saveRoomIdentity(session(stranger), form({ roomId, name: "Mine now", description: "x".repeat(50) }), deps),
    ).rejects.toBeInstanceOf(m.NotFoundError);
    expect((await m.setRateActive(session(stranger), pricedRate, false, deps)).ok).toBe(false);
    expect((await one<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [roomId]))!.name).toBe(
      "Deluxe King",
    );
  });

  test("the loaders return nothing for another host's room", async () => {
    expect(await loadRoomEditor(session(stranger), roomId, hostDb(session(stranger)))).toBeNull();
    expect(await loadRoomsIndex(session(stranger), propertyId, hostDb(session(stranger)))).toBeNull();
  });

  // ── Space and the units floor ───────────────────────────────────────

  test("writes the bed counts and the label guests read", async () => {
    expect((await m.saveRoomSpace(session(owner), spaceForm("3"), deps)).success).toBe(true);
    const row = await one<{ bed_config: object; bed_type: string; size_sqm: string; total_units: number }>(
      `SELECT bed_config, bed_type, size_sqm, total_units FROM rooms WHERE id = $1`,
      [roomId],
    );
    expect(row!.bed_config).toEqual({ king: 1, sofa_bed: 1 });
    expect(row!.bed_type).toBe("1 King · 1 Sofa bed");
    expect(Number(row!.size_sqm)).toBe(35);
  });

  test("units cannot drop below the busiest future night, which the error names", async () => {
    await book("confirmed", "2031-03-10", "2031-03-12", 1);
    await book("pending", "2031-03-11", "2031-03-12", 1);
    await book("cancelled", "2031-03-11", "2031-03-12", 5);

    const refused = await m.saveRoomSpace(session(owner), spaceForm("1"), deps);
    expect(refused.success).toBe(false);
    expect(refused.errors?.units?.[0]).toBe(
      "2 units are already booked on 11 March 2031. Set at least 2.",
    );
    expect((await one<{ total_units: number }>(`SELECT total_units FROM rooms WHERE id = $1`, [roomId]))!.total_units).toBe(3);

    expect((await m.saveRoomSpace(session(owner), spaceForm("2"), deps)).success).toBe(true);
  });

  test("past bookings do not hold units", async () => {
    await book("confirmed", "2020-03-10", "2020-03-12", 3);
    expect((await m.saveRoomSpace(session(owner), spaceForm("1"), deps)).success).toBe(true);
  });

  // ── Archive guards ──────────────────────────────────────────────────

  test("a room with an upcoming booking cannot be archived", async () => {
    const bookingId = await book("confirmed", "2031-05-01", "2031-05-03");
    const refused = await m.archiveRoom(session(owner), roomId, deps);
    expect(refused).toMatchObject({ ok: false, code: "future_bookings" });

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    expect((await m.archiveRoom(session(owner), roomId, deps)).ok).toBe(true);

    const row = await one<{ archived_at: string | null; is_active: boolean }>(
      `SELECT archived_at, is_active FROM rooms WHERE id = $1`,
      [roomId],
    );
    expect(row!.archived_at).not.toBeNull();
    expect(row!.is_active).toBe(false);
    // Archived rooms leave the editor and the index.
    expect(await loadRoomEditor(session(owner), roomId, hostDb(session(owner)))).toBeNull();
    expect((await loadRoomsIndex(session(owner), propertyId, hostDb(session(owner))))!.rooms).toHaveLength(0);
  });

  test("a rate with an upcoming booking cannot be archived", async () => {
    await book("pending", "2031-05-01", "2031-05-03", 1, pricedRate);
    expect(await m.archiveRate(session(owner), pricedRate, deps)).toMatchObject({
      ok: false,
      code: "future_bookings",
    });
    expect((await m.archiveRate(session(owner), unpricedRate, deps)).ok).toBe(true);
  });

  // ── Rate status ─────────────────────────────────────────────────────

  test("an unpriced rate cannot be switched on; a priced one can", async () => {
    const refused = await m.setRateActive(session(owner), unpricedRate, true, deps);
    expect(refused.ok).toBe(false);

    await db.query(`UPDATE rate_plans SET bar = 9000 WHERE id = $1`, [unpricedRate]);
    expect((await m.setRateActive(session(owner), unpricedRate, true, deps)).ok).toBe(true);
  });

  test("a published room keeps its last active rate", async () => {
    await db.query(`UPDATE rooms SET is_active = true WHERE id = $1`, [roomId]);

    expect(await m.setRateActive(session(owner), pricedRate, false, deps)).toMatchObject({
      ok: false,
      code: "last_active_rate",
    });
    expect(await m.archiveRate(session(owner), pricedRate, deps)).toMatchObject({
      ok: false,
      code: "last_active_rate",
    });

    // A draft room has no such floor.
    await db.query(`UPDATE rooms SET is_active = false WHERE id = $1`, [roomId]);
    expect((await m.setRateActive(session(owner), pricedRate, false, deps)).ok).toBe(true);
  });

  // ── Rate create, edit, duplicate ────────────────────────────────────

  test("a new rate is unpriced, non-refundable, inactive and last", async () => {
    const state = await m.saveRate(
      session(owner),
      form({
        roomId,
        ratePlanId: "",
        name: "Half Board",
        breakfast: "on",
        dinner: "on",
        extras: ["spa_access"],
        minAdvanceDays: "3",
        maxAdvanceDays: "180",
        cancellationText: "Free until 3 days before arrival.",
      }),
      deps,
    );
    expect(state.success).toBe(true);

    const row = await one<Record<string, unknown>>(
      `SELECT * FROM rate_plans WHERE room_id = $1 AND name = 'Half Board'`,
      [roomId],
    );
    expect(row).toMatchObject({
      bar: "0",
      is_refundable: false,
      is_active: false,
      currency: "EUR",
      includes_breakfast: true,
      includes_lunch: false,
      includes_dinner: true,
      extras: ["spa_access"],
      min_advance_booking: 3,
      max_advance_booking: 180,
      cancellation_policy: "Free until 3 days before arrival.",
      sort_order: 1,
    });
  });

  test("editing a rate never touches its price or refund flag, and blank policy is stored as none", async () => {
    const state = await m.saveRate(
      session(owner),
      form({ roomId, ratePlanId: pricedRate, name: "Standard", active: "on", cancellationText: "  " }),
      deps,
    );
    expect(state.success).toBe(true);
    const row = await one<{ bar: string; is_refundable: boolean; cancellation_policy: string | null }>(
      `SELECT bar, is_refundable, cancellation_policy FROM rate_plans WHERE id = $1`,
      [pricedRate],
    );
    expect(row).toEqual({ bar: "12000", is_refundable: true, cancellation_policy: null });
  });

  test("duplicate copies the terms and base rate, inactive, with (copy)", async () => {
    const result = await m.duplicateRate(session(owner), pricedRate, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = await one<Record<string, unknown>>(`SELECT * FROM rate_plans WHERE id = $1`, [
      result.ratePlanId,
    ]);
    expect(copy).toMatchObject({
      name: "Standard (copy)",
      bar: "12000",
      is_active: false,
      extras: ["parking"],
      room_id: roomId,
    });
  });

  // ── Room order ──────────────────────────────────────────────────────

  test("reorder writes the order, and refuses ids from another property", async () => {
    const second = (await one<{ id: string }>(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, sort_order)
       VALUES ($1, 'Twin', 2, 2, 1) RETURNING id`,
      [propertyId],
    ))!.id;

    expect((await m.reorderRooms(session(owner), propertyId, [second, roomId], deps)).ok).toBe(true);
    const order = await many<{ id: string }>(
      `SELECT id FROM rooms WHERE property_id = $1 ORDER BY sort_order`,
      [propertyId],
    );
    expect(order.map((r) => r.id)).toEqual([second, roomId]);

    const elsewhere = (await one<{ id: string }>(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults)
       SELECT id, 'Not yours', 2, 2 FROM properties WHERE id <> $1 LIMIT 1
       RETURNING id`,
      [propertyId],
    ))?.id ?? crypto.randomUUID();
    const refused = await m.reorderRooms(session(owner), propertyId, [roomId, second, elsewhere], deps);
    expect(refused.ok).toBe(false);
    // Refused as a whole: the earlier order is intact.
    const after = await many<{ id: string }>(
      `SELECT id FROM rooms WHERE property_id = $1 ORDER BY sort_order`,
      [propertyId],
    );
    expect(after.map((r) => r.id)).toEqual([second, roomId]);
  });

  test("a new room is a draft at the end of the list", async () => {
    const result = await m.createRoom(session(owner), propertyId, deps);
    expect(result.ok).toBe(true);
    const index = await loadRoomsIndex(session(owner), propertyId, hostDb(session(owner)));
    expect(index!.rooms.map((r) => r.status)).toEqual(["draft", "draft"]);
    expect(index!.rooms.at(-1)!.name).toBe("New room type");
  });

  // ── Amenities ───────────────────────────────────────────────────────

  test("featured keys mirror into room_amenities for the guest card", async () => {
    await db.query(
      `INSERT INTO amenities (label, icon, category) VALUES
         ('Free Wi-Fi', 'Wifi', 'Room & Comfort'), ('Mini Bar', 'Wine', 'Room & Comfort')
       ON CONFLICT (label) DO NOTHING`,
    );
    const state = await m.saveRoomAmenities(
      session(owner),
      form({ roomId, amenityKeys: ["wifi", "minibar", "toiletries"], featuredAmenityKeys: ["wifi", "toiletries"] }),
      deps,
    );
    expect(state.success).toBe(true);

    const mirrored = await many<{ label: string }>(
      `SELECT a.label FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id
       WHERE ra.room_id = $1 ORDER BY a.label`,
      [roomId],
    );
    // Featured and in the catalogue only: not the unfeatured minibar, and not
    // toiletries, which the catalogue has no row for.
    expect(mirrored.map((r) => r.label)).toEqual(["Free Wi-Fi"]);
  });

  test("a room never saved here reads its amenities from the legacy rows", async () => {
    await db.query(`UPDATE rooms SET amenity_keys = NULL WHERE id = $1`, [roomId]);
    await db.query(
      `INSERT INTO amenities (label, icon, category) VALUES ('Bathtub', 'Bath', 'Room & Comfort')
       ON CONFLICT (label) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO room_amenities (room_id, amenity_id) SELECT $1, id FROM amenities WHERE label = 'Bathtub'`,
      [roomId],
    );
    const data = await loadRoomEditor(session(owner), roomId, hostDb(session(owner)));
    expect(data!.room.amenityKeys).toEqual(["bathtub"]);
    expect(data!.room.featuredAmenityKeys).toEqual(["bathtub"]);
  });

  // ── Publishing ──────────────────────────────────────────────────────

  test("publishing is refused until every section is done", async () => {
    expect((await m.setRoomPublished(session(owner), roomId, true, deps)).ok).toBe(false);

    await db.query(
      `UPDATE rooms SET description = $2, size_sqm = 30, bed_config = '{"queen":1}',
                        amenity_keys = '{wifi}'
       WHERE id = $1`,
      [roomId, "x".repeat(60)],
    );
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `INSERT INTO room_images (room_id, url, sort_order, alt_text) VALUES ($1, $2, $3, 'A photo')`,
        [roomId, `https://img.test/${i}.jpg`, i],
      );
    }

    expect((await m.setRoomPublished(session(owner), roomId, true, deps)).ok).toBe(true);
    expect((await one<{ is_active: boolean }>(`SELECT is_active FROM rooms WHERE id = $1`, [roomId]))!.is_active).toBe(true);

    // Unpublishing is never gated.
    expect((await m.setRoomPublished(session(owner), roomId, false, deps)).ok).toBe(true);
  });
});
