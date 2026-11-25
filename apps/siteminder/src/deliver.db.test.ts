import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { AppBooking, AppBookingRoom, DeliveryReport } from "@openbookings/apps-contract";
import { type CoreClient, CoreApiError } from "./core-client";
import type { Queryable } from "./db/migrate";
import { type Post, classifyReply, deliverDue, reservationPoster } from "./deliver";
import { type AppInstallation, activeInstallations, upsertInstallation } from "./installations";
import { upsertFromFeed } from "./outbox-store";
import { type FakeSiteMinder, startFakeSiteMinder } from "./testing/fake-siteminder";
import { serialized, skipDbTests, withTestDb } from "./testing/db-harness";
import { type TickDeps, tick } from "./tick";

const reg = {
  installationId: "7a4e3d85-9f41-4e8a-b3c4-6d9e8f0a2b31",
  propertyCode: "SM-DELIVER-2031",
  propertyName: "Hotel Deliver",
  apiKey: "key-deliver",
  coreBaseUrl: "https://core.example",
};
const T0 = new Date("2031-04-01T08:00:00.000Z");
const B1 = "8b5f4e96-0a52-4f9b-84d5-7e0f9a1b3c41";
const B2 = "8b5f4e96-0a52-4f9b-84d5-7e0f9a1b3c42";
const REF = { [B1]: "OB-D4C1-2031", [B2]: "OB-D4C2-2031" } as Record<string, string>;
const UID = { [B1]: "OBD4C12031", [B2]: "OBD4C22031" } as Record<string, string>;
const reservation = { requestorId: "OBK", credentials: { username: "ob-channel", password: "x&y" } };

const room = (over: Partial<AppBookingRoom> = {}): AppBookingRoom => ({
  reservationId: "r1",
  roomCode: "DBL2031",
  ratePlanCode: "BAR2031",
  checkIn: "2031-05-01",
  checkOut: "2031-05-03",
  adults: 2,
  children: 0,
  infants: 0,
  cots: 0,
  extraBeds: 0,
  cancelled: false,
  nights: [
    { date: "2031-05-01", priceCents: 18650 },
    { date: "2031-05-02", priceCents: 18650 },
  ],
  touristTaxCents: 600,
  payAtPropertyCents: 0,
  ...over,
});

/** A booking whose totals add up from its rooms (as core sends them); `cancelled` cancels every room too. */
function booking(bookingId: string, version: number, over: { cancelled?: boolean; rooms?: AppBookingRoom[]; modifiedAt?: string } = {}): AppBooking {
  const cancelled = over.cancelled ?? false;
  const rooms = (over.rooms ?? [room()]).map((r) => (cancelled ? { ...r, cancelled: true } : r));
  const booked = rooms.filter((r) => !r.cancelled);
  return {
    bookingId,
    reference: REF[bookingId] as string,
    version,
    cancelled,
    createdAt: "2031-03-01T10:00:00Z",
    modifiedAt: over.modifiedAt ?? "2031-03-01T10:00:00Z",
    checkIn: "2031-05-01",
    checkOut: "2031-05-03",
    booker: { givenName: "Ada", surname: "Lovelace" },
    rooms,
    roomsTotalCents: booked.reduce((s, r) => s + r.nights.reduce((n, x) => n + x.priceCents, 0), 0),
    touristTaxCents: booked.reduce((s, r) => s + r.touristTaxCents, 0),
    commissionCents: 1679,
  };
}

/** A clock the test moves; `sleep` moves it too and records the wait. */
function fakeClock(start = T0) {
  const clock = {
    t: start.getTime(),
    slept: [] as number[],
    now: () => new Date(clock.t),
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

/** Core's delivery endpoint: records each report; `failNext(n)` makes the next n calls fail with a 500. */
function fakeCore() {
  const reports: { bookingId: string; report: DeliveryReport }[] = [];
  let failures = 0;
  const tried = { calls: 0 };
  /** Bookings the hotel chose not to send: core answers 409 not_sent. */
  const notSent = new Set<string>();
  const client = () =>
    ({
      reportDelivery: async (bookingId: string, report: DeliveryReport) => {
        tried.calls += 1;
        if (failures > 0) {
          failures -= 1;
          throw new CoreApiError("core /bookings/:bookingId/delivery answered 500", "server", 500, true);
        }
        if (notSent.has(bookingId)) return "not_sent";
        reports.push({ bookingId, report });
        return "stored";
      },
    }) as unknown as CoreClient;
  return { reports, client, tried, notSent, failNext: (n: number) => { failures += n; } };
}

type Row = {
  booking_id: string;
  status: string;
  acked: string;
  acked_version: string | null;
  attempts: number;
  last_error: string | null;
  report_pending: boolean;
  first_failed_at: string | null;
};
const rowOf = async (db: Queryable, bookingId = B1): Promise<Row> =>
  (
    await db.query<Row>(
      `SELECT booking_id, status, acked, acked_version::text, attempts, last_error, report_pending,
              to_char(first_failed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_failed_at
         FROM siteminder.outbox WHERE installation_id = $1 AND booking_id = $2`,
      [reg.installationId, bookingId],
    )
  ).rows[0] as Row;

const resStatus = (xml: string) => /ResStatus="([^"]+)"/.exec(xml)?.[1];
const uniqueId = (xml: string) => /<UniqueID Type="14" ID="([^"]+)"/.exec(xml)?.[1];
/** A test's own post (to look at or change things mid-send), with the same short timeout as the real poster. */
const withTimeout = (fn: (xml: string) => Promise<{ status: number; body: string }>): Post => Object.assign(fn, { timeoutMs: 300 });
const statuses = (core: ReturnType<typeof fakeCore>) => core.reports.map((r) => [r.report.status, r.report.version]);

// One set of spies for the whole file (a second spy on the same method is undone by the first one's restore).
const logged = { error: [] as unknown[][], warn: [] as unknown[][] };
const spies = [
  spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.error.push(args); }),
  spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logged.warn.push(args); }),
  spyOn(console, "info").mockImplementation(() => {}),
];
afterAll(() => { for (const s of spies) s.mockRestore(); });
const clearLogs = () => { logged.error.length = 0; logged.warn.length = 0; };

describe("classifyReply", () => {
  const rs = (inner: string) =>
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body>` +
    `<OTA_HotelResNotifRS xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="echo-2031" TimeStamp="2031-04-01T08:00:00+00:00" Version="1.0">${inner}</OTA_HotelResNotifRS>` +
    `</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const bare = (inner: string) => `<OTA_HotelResNotifRS xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="echo-2031" Version="1.0">${inner}</OTA_HotelResNotifRS>`;

  it("Success (in a SOAP envelope or bare, with or without warnings) is ok", () => {
    expect(classifyReply(rs(`<Success/><HotelReservations><HotelReservation><UniqueID Type="14" ID="X"/></HotelReservation></HotelReservations>`))).toEqual({ ok: true });
    expect(classifyReply(bare(`<Success/>`))).toEqual({ ok: true });
    expect(classifyReply(rs(`<Success/><Warnings><Warning Type="11">Something to note</Warning></Warnings>`))).toEqual({ ok: true });
  });

  it("the docs' credentials, hotel and missing-node errors are permanent", () => {
    expect(classifyReply(rs(`<Errors><Error Type="4">Invalid Username and/or Password for ABC</Error></Errors>`))).toEqual({
      ok: false,
      permanent: true,
      error: "SiteMinder error Type 4: Invalid Username and/or Password for ABC",
    });
    expect(classifyReply(bare(`<Errors><Error Type="6">Hotel not found for HotelCode=HOTELCODE</Error></Errors>`))).toMatchObject({ ok: false, permanent: true });
    expect(classifyReply(rs(`<Errors><Error Type="6">No HotelCodes were found in the message payload. Authorisation cannot proceed.</Error></Errors>`))).toMatchObject({ permanent: true });
    expect(classifyReply(rs(`<Errors><Error Type="10">Node CreateDateTime must exist</Error></Errors>`))).toMatchObject({ permanent: true });
  });

  it("any other SiteMinder error is transient, and so is a reply it cannot read", () => {
    expect(classifyReply(rs(`<Errors><Error Type="12">Unable to process</Error></Errors>`))).toEqual({ ok: false, permanent: false, error: "SiteMinder error Type 12: Unable to process" });
    expect(classifyReply(rs(`<Errors><Error Type="12">a</Error><Error Type="4">Invalid Username and/or Password</Error></Errors>`))).toMatchObject({ permanent: true });
    clearLogs();
    expect(classifyReply(rs(``))).toMatchObject({ ok: false, permanent: false });
    expect(logged.warn[0]?.[0]).toMatch(/neither Success nor Errors/);
    expect(classifyReply(`<html><body>Bad gateway</body></html>`)).toMatchObject({ ok: false, permanent: false });
    expect(classifyReply(`not xml at all <`)).toMatchObject({ ok: false, permanent: false });
    expect(classifyReply(``)).toMatchObject({ ok: false, permanent: false });
  });
});

describe.skipIf(skipDbTests)("deliver bookings to SiteMinder (rolled back)", () => {
  let sm: FakeSiteMinder;
  beforeEach(() => {
    sm = startFakeSiteMinder({ port: 0 });
    clearLogs();
  });
  afterEach(() => sm.stop());

  type Deps = TickDeps & { post: Post };
  const mkDeps = (db: Queryable, core: ReturnType<typeof fakeCore>, clock: ReturnType<typeof fakeClock>, post?: Post): Deps => ({
    db: serialized(db),
    client: core.client,
    now: clock.now,
    sleep: clock.sleep,
    post: post ?? reservationPoster(() => sm.url, 300),
    reservation,
  });
  const setup = async (db: Queryable): Promise<AppInstallation> => {
    await upsertInstallation(db, reg);
    return (await activeInstallations(db)).find((i) => i.id === reg.installationId) as AppInstallation;
  };
  const run = (deps: Deps, budgetMs = 50_000) => deliverDue(deps, { budgetMs, installationId: reg.installationId });

  it("a new booking: one Commit, outbox delivered, core told delivered with the ack time", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });

      expect(sm.received.map(resStatus)).toEqual(["Commit"]);
      expect(uniqueId(sm.received[0] as string)).toBe(UID[B1]);
      expect(sm.received[0]).toContain(`<BasicPropertyInfo HotelCode="${reg.propertyCode}"/>`);
      expect(sm.received[0]).toContain(`<wsse:Username>ob-channel</wsse:Username>`);
      expect(sm.received[0]).toContain(`<RequestorID Type="22" ID="OBK"/>`);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", acked_version: "1", attempts: 0, last_error: null, report_pending: false });
      expect(core.reports).toEqual([{ bookingId: B1, report: { status: "delivered", acknowledgedAt: T0.toISOString(), detail: null, version: 1 } }]);

      // Nothing left to do: the next run sends and reports nothing.
      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(1);
      expect(core.reports).toHaveLength(1);
    });
  });

  it("two HTTP 500s: delivered on the 3rd attempt after waiting 5 s and 15 s", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(2, "http500");

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 2, needsAttention: 0 });

      expect(clock.slept).toEqual([5_000, 15_000]);
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Commit", "Commit"]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", acked_version: "1", attempts: 0, last_error: null });
      // Retrying is told once, not per failure; delivered carries the time of the successful attempt.
      expect(core.reports.map((r) => r.report)).toEqual([
        { status: "retrying", acknowledgedAt: null, detail: "SiteMinder answered HTTP 500", version: 1 },
        { status: "delivered", acknowledgedAt: "2031-04-01T08:00:20.000Z", detail: null, version: 1 },
      ]);
    });
  });

  it("a retry later than the budget allows is left for the next tick", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "http500");

      expect(await run(mkDeps(db, core, clock), 3_000)).toEqual({ delivered: 0, retrying: 1, needsAttention: 0 });
      expect(clock.slept).toEqual([]);
      const { rows } = await db.query<{ next_attempt_at: Date }>(`SELECT next_attempt_at FROM siteminder.outbox WHERE booking_id = $1`, [B1]);
      expect(rows[0]?.next_attempt_at.toISOString()).toBe("2031-04-01T08:00:05.000Z");

      // Not due yet: nothing is sent.
      expect(await run(mkDeps(db, core, clock), 3_000)).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      clock.t += 5_000;
      expect(await run(mkDeps(db, core, clock), 3_000)).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(2);
    });
  });

  it("five timeouts: still retrying, our own alert at the 5th, core told retrying once; the 6th delivers", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(5, "timeout");

      expect(await run(mkDeps(db, core, clock), 1_000_000)).toEqual({ delivered: 1, retrying: 5, needsAttention: 0 });

      expect(clock.slept).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
      expect(sm.received).toHaveLength(6);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", attempts: 0, last_error: null, first_failed_at: null });
      // Hotels are not told about a short outage: core hears retrying once, then delivered.
      expect(statuses(core)).toEqual([["retrying", 1], ["delivered", 1]]);
      expect(core.reports[0]?.report.detail).toMatch(/no answer from SiteMinder/);
      // We are: one alert at the 5th consecutive failure.
      expect(logged.error.map((e) => e[0])).toEqual(["[siteminder] a booking failed 5 times in a row delivering to SiteMinder; still retrying"]);
    });
  });

  it("transient failures for 30 minutes since the first: needs_attention, told once, not retried after", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1_000, "http500");

      // A long run of ticks: each one picks up the retry that is due (no inline wait beyond 60 s).
      for (let n = 0; n < 60; n++) {
        await run(mkDeps(db, core, clock), 1_000);
        clock.t += 60_000;
      }

      // One attempt per tick, 60 s apart: at 0, 60, ..., 1740 s retrying; the one at 1800 s is final.
      const row = await rowOf(db);
      expect(row).toMatchObject({ status: "needs_attention", acked: "none", attempts: 31, last_error: "SiteMinder answered HTTP 500" });
      expect(sm.received).toHaveLength(31);
      expect(statuses(core)).toEqual([["retrying", 1], ["needs_attention", 1]]);
      expect(logged.error.map((e) => e[0])).toEqual([
        "[siteminder] a booking failed 5 times in a row delivering to SiteMinder; still retrying",
        "[siteminder] a booking could not be delivered to SiteMinder and needs attention",
      ]);
      const sent = sm.received.length;
      clock.t += 3_600_000;
      expect(await run(mkDeps(db, core, clock), 1_000)).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(sent);
    });
  });

  it("the retry window is the current message's: a newer version starts it again", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "http500");
      await run(mkDeps(db, core, clock), 1_000);
      expect(await rowOf(db)).toMatchObject({ status: "retrying", attempts: 1, first_failed_at: T0.toISOString() });

      await upsertFromFeed(db, inst, booking(B1, 2), T0);
      expect(await rowOf(db)).toMatchObject({ status: "waiting", attempts: 0, first_failed_at: null });
    });
  });

  it("no send starts when the remaining budget cannot hold a full timeout", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);

      expect(await run(mkDeps(db, core, clock), 299)).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toEqual([]);
      expect(await rowOf(db)).toMatchObject({ status: "waiting" });
      expect(await run(mkDeps(db, core, clock), 300)).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
    });
  });

  it("a credentials error: needs_attention at once", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "auth");

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 1 });
      expect(sm.received).toHaveLength(1);
      expect(clock.slept).toEqual([]);
      expect(await rowOf(db)).toMatchObject({ status: "needs_attention", acked: "none", attempts: 1 });
      expect(core.reports.map((r) => r.report)).toEqual([
        { status: "needs_attention", acknowledgedAt: null, detail: "SiteMinder error Type 4: Invalid Username and/or Password for OBK", version: 1 },
      ]);
    });
  });

  it("a validation error (Type 10): needs_attention at once", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "error");

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 1 });
      expect(sm.received).toHaveLength(1);
      expect(await rowOf(db)).toMatchObject({ status: "needs_attention", acked: "none", attempts: 1, last_error: "SiteMinder error Type 10: Node CreateDateTime must exist" });
      expect(statuses(core)).toEqual([["needs_attention", 1]]);
    });
  });

  it("a Commit whose answer never came, then v2: Commit, Commit, Modify, delivered at v2", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "timeout"); // the fake records the Commit: SiteMinder may hold v1

      expect(await run(mkDeps(db, core, clock), 1_000)).toEqual({ delivered: 0, retrying: 1, needsAttention: 0 });
      await upsertFromFeed(db, inst, booking(B1, 2, { rooms: [room({ adults: 1 })] }), T0);
      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });

      // The v2 Commit is ignored by SiteMinder (repeated ID) if v1 arrived, so a Modify carries v2.
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Commit", "Modify"]);
      expect(sm.received[2]).toContain(`<GuestCount AgeQualifyingCode="10" Count="1"/>`);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", acked_version: "2" });
      const { rows } = await db.query<{ v: string | null }>(`SELECT commit_attempt_version::text AS v FROM siteminder.outbox WHERE booking_id = $1`, [B1]);
      expect(rows[0]?.v).toBeNull();
      expect(statuses(core)).toEqual([["retrying", 1], ["delivered", 2]]);
    });
  });

  it("a newer version arriving during a send that fails transiently is a new message: sent next, clean slate", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      const sdb = serialized(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await run(mkDeps(db, core, clock));
      await upsertFromFeed(db, inst, booking(B1, 2, { rooms: [room({ adults: 1 })] }), T0);
      sm.failNext(1, "http500");
      const http = reservationPoster(() => sm.url, 300);
      const seenByLastSend: Row[] = [];
      let sends = 0;
      const post: Post = withTimeout(async (xml) => {
        sends += 1;
        if (sends === 1) await upsertFromFeed(sdb, inst, booking(B1, 3, { rooms: [room({ adults: 2, children: 1 })] }), T0);
        else seenByLastSend.push(await rowOf(sdb));
        return http(xml);
      });

      expect(await run({ ...mkDeps(db, core, clock), db: sdb, post })).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Modify", "Modify"]);
      expect(sm.received[2]).toContain(`<GuestCount AgeQualifyingCode="8" Count="1"/>`);
      expect(clock.slept).toEqual([]);
      expect(seenByLastSend).toMatchObject([{ attempts: 0, first_failed_at: null, last_error: null, acked_version: "1" }]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked_version: "3" });
      expect(statuses(core)).toEqual([["delivered", 1], ["delivered", 3]]);
    });
  });

  it("a newer version arriving during a send that is refused for good is still sent", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      const sdb = serialized(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "error");
      const http = reservationPoster(() => sm.url, 300);
      let sends = 0;
      const post: Post = withTimeout(async (xml) => {
        sends += 1;
        if (sends === 1) await upsertFromFeed(sdb, inst, booking(B1, 2), T0);
        return http(xml);
      });

      expect(await run({ ...mkDeps(db, core, clock), db: sdb, post })).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      // v1 was refused; v2 goes out as a Commit (and a harmless Modify, since a Commit of v1 had been tried).
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Commit", "Modify"]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked_version: "2", attempts: 0, first_failed_at: null, last_error: null });
      expect(statuses(core)).toEqual([["delivered", 2]]);
    });
  });

  it("a version that lands between reading the fresh row and writing it is not lost (compare and set)", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      const sdb = serialized(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      let landed = false;
      const racing = {
        query: async (text: string, params?: unknown[]) => {
          const result = await sdb.query(text, params);
          // Right after the settle's read of the fresh row, before its UPDATE.
          if (!landed && text.startsWith("SELECT booking_id, latest") && text.includes("claim_token = $3")) {
            landed = true;
            await upsertFromFeed(sdb, inst, booking(B1, 2, { rooms: [room({ adults: 1 })] }), T0);
          }
          return result;
        },
      } as unknown as Queryable;

      expect(await run({ ...mkDeps(db, core, clock), db: racing })).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(landed).toBe(true);
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Modify"]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked_version: "2" });
      // The decision made on the stale read (delivered v1) was never written nor reported.
      expect(statuses(core)).toEqual([["delivered", 2]]);
    });
  });

  it("a send whose claim ran out (its tick died) is taken over, not before", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await db.query(`UPDATE siteminder.outbox SET status = 'sending', claim_token = gen_random_uuid(), next_attempt_at = $1 WHERE booking_id = $2`, [
        new Date(T0.getTime() + 10_000).toISOString(),
        B1,
      ]);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toEqual([]);
      clock.t += 10_000;
      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(sm.received.map(resStatus)).toEqual(["Commit"]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed" });
    });
  });

  it("core down: one failed report and the rest of the run skips core; the next tick sends them all", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await upsertFromFeed(db, inst, booking(B2, 1), new Date(T0.getTime() + 1));
      core.failNext(1);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 2, retrying: 0, needsAttention: 0 });
      expect(core.tried.calls).toBe(1);
      expect((await rowOf(db, B1)).report_pending).toBe(true);
      expect((await rowOf(db, B2)).report_pending).toBe(true);

      await tick(mkDeps(db, core, clock), { budgetMs: 1_000 });
      expect(core.reports.map((r) => r.bookingId).sort()).toEqual([B1, B2].sort());
      expect((await rowOf(db, B1)).report_pending).toBe(false);
      expect((await rowOf(db, B2)).report_pending).toBe(false);
    });
  });

  it("a booking cancelled before its first delivery: Commit then Cancel, in that order", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 2, { cancelled: true }), T0);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Cancel"]);
      expect(sm.received.map(uniqueId)).toEqual([UID[B1], UID[B1]]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "cancelled", acked_version: "2" });
      expect(statuses(core)).toEqual([["delivered", 2]]);
    });
  });

  it("two bookings deliver independently while one keeps failing", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await upsertFromFeed(db, inst, booking(B2, 1), new Date(T0.getTime() + 1));
      sm.failNext(1_000, "http500", UID[B1]);

      // Room for B1's attempts at 0, 5, 20 and 50 s; its next one (110 s) is left for a later tick.
      const counts = await run(mkDeps(db, core, clock), 100_000);
      expect(counts).toEqual({ delivered: 1, retrying: 4, needsAttention: 0 });
      expect(await rowOf(db, B1)).toMatchObject({ status: "retrying", attempts: 4 });
      expect(await rowOf(db, B2)).toMatchObject({ status: "delivered", acked: "committed" });
      // B2 went out right after B1's first failure, not after B1's retries.
      expect(sm.received.slice(0, 2).map(uniqueId)).toEqual([UID[B1], UID[B2]]);
      expect(core.reports.find((r) => r.bookingId === B2)?.report).toEqual({ status: "delivered", acknowledgedAt: T0.toISOString(), detail: null, version: 1 });
    });
  });

  it("a newer version that arrives during a send ends 'waiting' and is sent next", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      const sdb = serialized(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      const http = reservationPoster(() => sm.url, 300);
      const seenBySecondSend: Row[] = [];
      let sends = 0;
      const post: Post = withTimeout(async (xml) => {
        sends += 1;
        if (sends === 1) {
          // v2 lands while the Commit of v1 is in flight.
          await upsertFromFeed(sdb, inst, booking(B1, 2, { modifiedAt: "2031-03-02T10:00:00Z", rooms: [room({ adults: 1 })] }), T0);
        } else {
          seenBySecondSend.push(await rowOf(sdb));
        }
        return http(xml);
      });

      expect(await run({ ...mkDeps(db, core, clock), db: sdb, post })).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });

      expect(sm.received.map(resStatus)).toEqual(["Commit", "Modify"]);
      expect(sm.received[0]).toContain(`<GuestCount AgeQualifyingCode="10" Count="2"/>`);
      expect(sm.received[1]).toContain(`<GuestCount AgeQualifyingCode="10" Count="1"/>`);
      // The Commit's result kept v2: acked at 1, still to send (the row was claimed again for the Modify).
      expect(seenBySecondSend).toMatchObject([{ acked: "committed", acked_version: "1", status: "sending" }]);
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", acked_version: "2" });
      expect(statuses(core)).toEqual([["delivered", 2]]);
    });
  });

  it("reopened after a delivered Cancel: needs_attention, told once, never re-committed", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await run(mkDeps(db, core, clock));
      await upsertFromFeed(db, inst, booking(B1, 2, { cancelled: true }), T0);
      await run(mkDeps(db, core, clock));
      await upsertFromFeed(db, inst, booking(B1, 3), T0);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 1 });
      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });

      expect(sm.received.map(resStatus)).toEqual(["Commit", "Cancel"]);
      expect(await rowOf(db)).toMatchObject({ status: "needs_attention", acked: "cancelled", acked_version: "2", last_error: "reopened after cancellation — tell the hotel" });
      expect(statuses(core)).toEqual([["delivered", 1], ["delivered", 2], ["needs_attention", 3]]);
      expect(core.reports[2]?.report).toEqual({ status: "needs_attention", acknowledgedAt: null, detail: "reopened after cancellation — tell the hotel", version: 3 });
    });
  });

  it("reopened while its Cancel is in flight: needs_attention once the Cancel is acked", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      const sdb = serialized(db);
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      await run(mkDeps(db, core, clock));
      await upsertFromFeed(db, inst, booking(B1, 2, { cancelled: true }), T0);
      const http = reservationPoster(() => sm.url, 300);
      const post: Post = withTimeout(async (xml) => {
        if (resStatus(xml) === "Cancel") await upsertFromFeed(sdb, inst, booking(B1, 3), T0);
        return http(xml);
      });

      expect(await run({ ...mkDeps(db, core, clock), db: sdb, post })).toEqual({ delivered: 0, retrying: 0, needsAttention: 1 });
      expect(sm.received.map(resStatus)).toEqual(["Commit", "Cancel"]);
      expect(await rowOf(db)).toMatchObject({ status: "needs_attention", acked: "cancelled", acked_version: "2" });
      expect(statuses(core)).toEqual([["delivered", 1], ["needs_attention", 3]]);
    });
  });

  it("a booking the builder refuses (no adults): needs_attention with the reason, nothing sent", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1, { rooms: [room({ adults: 0 })] }), T0);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 1 });
      expect(sm.received).toEqual([]);
      const row = await rowOf(db);
      expect(row).toMatchObject({ status: "needs_attention", acked: "none" });
      expect(row.last_error).toMatch(/could not build the reservation: .*no adults/);
      expect(statuses(core)).toEqual([["needs_attention", 1]]);
      expect(core.reports[0]?.report.detail).toMatch(/no adults/);
    });
  });

  it("a failed report to core keeps the outbox state and is retried by the next tick", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      core.failNext(1);

      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(await rowOf(db)).toMatchObject({ status: "delivered", acked: "committed", report_pending: true });
      expect(core.reports).toEqual([]);
      expect(logged.warn.map((w) => w[0])).toEqual(["[siteminder] reporting a delivery to core failed; the next tick tries again"]);

      clock.t += 60_000;
      const result = await tick(mkDeps(db, core, clock), { budgetMs: 1_000 });
      expect(result.delivery).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(core.reports).toEqual([{ bookingId: B1, report: { status: "delivered", acknowledgedAt: T0.toISOString(), detail: null, version: 1 } }]);
      expect(await rowOf(db)).toMatchObject({ report_pending: false });
      expect(sm.received).toHaveLength(1);
    });
  });

  it("core answers not_sent: the outbox row becomes not_sent and nothing more is sent for it", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      core.notSent.add(B1);
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);

      await run(mkDeps(db, core, clock));
      expect(await rowOf(db)).toMatchObject({ status: "not_sent", report_pending: false });
      expect(sm.received).toHaveLength(1);

      // A later change is not sent either.
      clock.t += 60_000;
      await upsertFromFeed(db, inst, booking(B1, 2), clock.now());
      expect(await run(mkDeps(db, core, clock))).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(1);
      expect(await rowOf(db)).toMatchObject({ status: "not_sent" });
    });
  });

  it("the tick delivers waiting bookings and due retries between polls", async () => {
    await withTestDb(async (db) => {
      const inst = await setup(db);
      const core = fakeCore();
      const clock = fakeClock();
      await upsertFromFeed(db, inst, booking(B1, 1), T0);
      sm.failNext(1, "http500");

      // No inbox messages and no polling: the waiting booking alone gets the installation processed.
      expect((await tick(mkDeps(db, core, clock), { budgetMs: 1_000 })).delivery).toEqual({ delivered: 0, retrying: 1, needsAttention: 0 });
      expect((await tick(mkDeps(db, core, clock), { budgetMs: 1_000 })).delivery).toEqual({ delivered: 0, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(1);
      clock.t += 5_000;
      expect((await tick(mkDeps(db, core, clock), { budgetMs: 1_000 })).delivery).toEqual({ delivered: 1, retrying: 0, needsAttention: 0 });
      expect(sm.received).toHaveLength(2);
      expect(statuses(core)).toEqual([["retrying", 1], ["delivered", 1]]);
    });
  });
});
