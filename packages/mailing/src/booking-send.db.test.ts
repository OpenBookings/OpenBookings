import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { sendBookingCancelled, sendBookingConfirmed, sendOversoldRefunded, type SendDeps } from "./booking-send";

let db: Client;
let sent: { to: string; subject: string; html: string }[];

const urls = { webUrl: "https://web.test", businessUrl: "https://biz.test" };
const transport: NonNullable<SendDeps["transport"]> = async (m) => {
  sent.push(m);
};
const deps = (extra: SendDeps = {}): SendDeps => ({ db, transport, urls, testing: false, ...extra });
const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

describeWithDb("booking emails against Postgres", () => {
  let bookingId: string;
  let reservationIds: string[];
  let propertyId: string;
  let guestEmail: string;
  const ownerEmails: string[] = [];

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    sent = [];
    ownerEmails.length = 0;
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    const ids = await seedProperty(db, { tier: "flex" });
    propertyId = ids.propertyId;
    await db.query(`UPDATE properties SET name = 'Hotel <Test>' WHERE id = $1`, [propertyId]);
    const org = crypto.randomUUID();
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [org]);
    await db.query(`UPDATE properties SET organization_id = $2 WHERE id = $1`, [propertyId, org]);
    for (const role of ["owner", "owner", "member"]) {
      const id = crypto.randomUUID();
      const email = `${role}-${id}@example.test`;
      await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'Host', $2, true, 'business'::account_type)`, [id, email]);
      await db.query(`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`, [org, id, role]);
      if (role === "owner") ownerEmails.push(email);
    }
    ({ bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2027-03-12", nights: 2, rooms: 2 }));
    // The second room is a different room, so a partial cancel can be told apart.
    const suite = await one<{ id: string }>(`INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active) VALUES ($1, 'Garden Suite', 2, 2, 2, true) RETURNING id`, [propertyId]);
    await db.query(`UPDATE reservations SET room_id = $2 WHERE id = $1`, [reservationIds[1], suite.id]);
    await db.query(`UPDATE rooms SET name = 'Deluxe Double' WHERE id = $1`, [ids.roomId]);
    // €100 a night + €3 tax, two nights, two rooms = €412.
    await db.query(`UPDATE reservations SET nights = $1::jsonb`, [JSON.stringify([{ date: "2027-03-12", price: 100, touristTax: 3 }, { date: "2027-03-13", price: 100, touristTax: 3 }])]);
    guestEmail = (await one<{ email: string }>(`SELECT u.email FROM bookings b JOIN "user" u ON u.id = b.user_id WHERE b.id = $1`, [bookingId])).email;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const to = () => sent.map((m) => m.to).sort();

  test("a confirmation goes to the guest and to every owner, with rooms and total", async () => {
    await sendBookingConfirmed(bookingId, deps());
    expect(to()).toEqual([guestEmail, ...ownerEmails].sort());
    const guestMail = sent.find((m) => m.to === guestEmail)!;
    expect(guestMail.subject).toBe("Booking confirmed: Hotel <Test>");
    expect(guestMail.html).toContain("Hotel &lt;Test&gt;");
    expect(guestMail.html).toContain("Deluxe Double");
    expect(guestMail.html).toContain("Garden Suite");
    expect(guestMail.html).toContain("€412.00");
    expect(guestMail.html).toContain("Fri 12 Mar 2027");
    expect(guestMail.html).toContain(`https://web.test/bookings/${bookingId}`);
    expect(sent.find((m) => m.to !== guestEmail)!.html).toContain("https://biz.test/dashboard/bookings/reservations");
  });

  test("a free-cancellation deadline shows with its time, and a past one shows as non-refundable", async () => {
    await db.query(`UPDATE reservations SET full_refund_until = '2099-03-11T14:00:00Z' WHERE id = $1`, [reservationIds[0]]);
    await db.query(`UPDATE reservations SET full_refund_until = '2000-01-01T00:00:00Z' WHERE id = $1`, [reservationIds[1]]);
    await sendBookingConfirmed(bookingId, deps());
    const html = sent.find((m) => m.to === guestEmail)!.html;
    expect(html).toContain("free cancellation until Wed 11 Mar 2099, 15:00");
    expect(html).toContain("non-refundable");
  });

  test("in testing mode a demo hotel's host mail goes to the guest", async () => {
    await db.query(`UPDATE properties SET is_demo = true WHERE id = $1`, [propertyId]);
    await sendBookingConfirmed(bookingId, deps({ testing: true }));
    expect(to()).toEqual([guestEmail, guestEmail]);
    expect(sent.map((m) => m.subject).sort()).toEqual(["Booking confirmed: Hotel <Test>", "New booking at Hotel <Test>"]);
  });

  test("a partial cancellation mails exactly the cancelled room and refund", async () => {
    await sendBookingCancelled(bookingId, { reservationIds: [reservationIds[0]], refundTotal: 103, cancelsBooking: false }, undefined, deps());
    expect(to()).toEqual([guestEmail, ...ownerEmails].sort());
    for (const m of sent) {
      expect(m.html).toContain("Deluxe Double");
      expect(m.html).not.toContain("Garden Suite");
      expect(m.subject).toStartWith("Rooms cancelled");
    }
    expect(sent.find((m) => m.to === guestEmail)!.html).toContain("€103.00");
  });

  test("an oversold refund states the intent's total, which already includes tourist tax", async () => {
    // €400 of rooms + €12 tourist tax: the guest was charged (and refunded) €412.
    const intent = await one<{ id: string }>(
      `INSERT INTO booking_intents
         (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at,
          snapshot, total_amount, tourist_tax_amount)
       SELECT b.user_id, $2, '2027-03-12', '2027-03-14', 'refunded_oversold', NOW(), '{}'::jsonb, 412, 12
         FROM bookings b WHERE b.id = $1
       RETURNING id`,
      [bookingId, propertyId],
    );
    await sendOversoldRefunded(intent.id, deps());
    expect(to()).toEqual([guestEmail]);
    expect(sent[0]!.html).toContain("€412.00");
    expect(sent[0]!.html).not.toContain("€424.00");
  });

  test("a failing sender is reported, never thrown", async () => {
    const reported: { error: unknown; kind: string }[] = [];
    const failing: SendDeps["transport"] = async () => {
      throw new Error("provider down");
    };
    await sendBookingCancelled(
      bookingId,
      { reservationIds, refundTotal: 0, cancelsBooking: true },
      (error, ctx) => reported.push({ error, kind: ctx.kind }),
      deps({ transport: failing }),
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]!.kind).toBe("cancellation");
    expect((reported[0]!.error as Error).message).toBe("provider down");
  });

  test("a failed host lookup does not stop the guest's mail", async () => {
    const flaky = {
      query: (text: string, values?: unknown[]) => {
        if (text.includes("is_demo")) throw new Error("lookup failed");
        return db.query(text, values);
      },
    };
    await expect(sendBookingConfirmed(bookingId, deps({ db: flaky }))).rejects.toThrow("lookup failed");
    expect(to()).toEqual([guestEmail]);
  });
});
