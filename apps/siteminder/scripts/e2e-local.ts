/**
 * End-to-end check of the SiteMinder app against a real local core, with SiteMinder played by the fake
 * reservation endpoint. README "End to end against a local core" lists what must run first: the local test
 * database (`bun run testing:db && bun run testing:setup`), business on :3001 and web on :3002 against it with
 * Stripe test keys, and `stripe listen`. Then, from apps/siteminder:
 *
 *   bun run scripts/e2e-local.ts
 *
 * What it does, stopping at the first wrong answer:
 *  1. Starts the fake SiteMinder (:4011) and this app (:3006, always-on, 5 s poll) on SITEMINDER_DATABASE_URL.
 *  2. Connects the hotel (default Canal Lantern Hotel) with the Channel manager's own connect function, as its owner.
 *  3. Replays a 750-day load for one room and rate plan and waits until core holds SiteMinder's availability.
 *  4. Asks you to book that room on the guest site with the test card 4242 4242 4242 4242 (the payment form is
 *     Stripe's, in the browser), then waits for the Commit at the fake SiteMinder and for the booking to show "Sent".
 *  5. Checks availability went down by one; then, 3 minutes after the acknowledgement, replays SiteMinder's new
 *     limit and checks availability did not go down twice.
 *  6. Cancels the booking as the host, waits for the Cancel, checks the room comes back only with SiteMinder's next
 *     limit (SiteMinder frees nothing on Cancel without Auto-Replenishment), and disconnects.
 *
 * Core-side steps run in apps/business/scripts/siteminder-e2e-core.ts: this app may not import core packages.
 * Both databases must be on localhost; the script refuses anything else before it starts.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertLocalDatabase } from "./local-db";

const OTA_NAMESPACE = "http://www.opentravel.org/OTA/2003/05";
const HELPER_MARKER = "E2E_RESULT ";
/** A booking stops counting against SiteMinder's limit once a limit arrives this long after the acknowledgement. */
const SETTLE_AFTER_ACK_MS = 3 * 60_000;

// ── Pure helpers (scripts/e2e-local.test.ts) ─────────────────────────────────

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

export type SentReservation = { status: string; uniqueId: string; hotelCode: string; start: string; end: string };

/** What a reservation message the app sent to SiteMinder says, or null when it is not one. */
export function parseReservation(xml: string): SentReservation | null {
  const status = /<OTA_HotelResNotifRQ\b[^>]*\bResStatus="([^"]+)"/.exec(xml)?.[1];
  if (!status) return null;
  return {
    status,
    uniqueId: /<UniqueID\b[^>]*\bID="([^"]*)"/.exec(xml)?.[1] ?? "",
    hotelCode: /<BasicPropertyInfo\b[^>]*\bHotelCode="([^"]*)"/.exec(xml)?.[1] ?? "",
    start: /<TimeSpan\b[^>]*\bStart="([^"]*)"/.exec(xml)?.[1] ?? "",
    end: /<TimeSpan\b[^>]*\bEnd="([^"]*)"/.exec(xml)?.[1] ?? "",
  };
}

/** The first message in `received` for this hotel with this status (and booking, when given). */
export function findReservation(
  received: readonly string[],
  match: { hotelCode: string; status: "Commit" | "Modify" | "Cancel"; uniqueId?: string },
): SentReservation | null {
  for (const xml of received) {
    const r = parseReservation(xml);
    if (r && r.hotelCode === match.hotelCode && r.status === match.status && (!match.uniqueId || r.uniqueId === match.uniqueId)) {
      return r;
    }
  }
  return null;
}

/** SiteMinder's availability update: one BookingLimit per night, as `OTA_HotelAvailNotifRQ` (replay.ts wraps it). */
export function limitMessage(i: { hotelCode: string; room: string; rate: string; limits: { date: string; limit: number }[] }): string {
  const messages = i.limits
    .map(
      ({ date, limit }) =>
        `<AvailStatusMessage BookingLimit="${limit}"><StatusApplicationControl Start="${date}" End="${date}" InvTypeCode="${i.room}" RatePlanCode="${i.rate}"/></AvailStatusMessage>`,
    )
    .join("");
  return (
    `<OTA_HotelAvailNotifRQ xmlns="${OTA_NAMESPACE}" EchoToken="x" TimeStamp="x" Version="1.0">` +
    `<AvailStatusMessages HotelCode="${i.hotelCode}">${messages}</AvailStatusMessages></OTA_HotelAvailNotifRQ>`
  );
}

export type Night = { date: string; bookable: number; limit: number | null };

/** Nights whose bookable units are not what was expected, as readable lines. Empty when all match. */
export function unitProblems(nights: readonly Night[], expected: ReadonlyMap<string, number>): string[] {
  const problems: string[] = [];
  for (const [date, want] of expected) {
    const night = nights.find((n) => n.date === date);
    if (!night) problems.push(`${date}: missing`);
    else if (night.bookable !== want) problems.push(`${date}: ${night.bookable} left, expected ${want}`);
  }
  return problems;
}

/** The helper's answer: the JSON after the last `E2E_RESULT ` line of its stdout. */
export function parseHelperOutput(stdout: string): unknown {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(HELPER_MARKER));
  if (line === undefined) throw new Error("the core helper printed no result");
  return JSON.parse(line.slice(HELPER_MARKER.length));
}

// ── The run ──────────────────────────────────────────────────────────────────

type Units = { onSale: boolean; nights: Night[] };
type Status = {
  bookingId: string;
  bookingStatus: string;
  delivery: { status: string; acknowledgedAt: string | null; detail: string | null } | null;
  badge: { label: string; detail: string } | null;
} | null;
type Hotel = {
  propertyCode: string;
  slug: string;
  timezone: string;
  today: string;
  roomCode: string;
  roomName: string;
  rateCode: string;
  rateName: string;
};

class CheckFailed extends Error {}

function check(ok: boolean, what: string): void {
  if (!ok) throw new CheckFailed(what);
  console.log(`  ok  ${what}`);
}

async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined>, timeoutMs: number, everyMs = 3000): Promise<T> {
  const started = Date.now();
  let lastNote = started;
  console.log(`  ..  waiting for ${what}`);
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new CheckFailed(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}`);
    if (Date.now() - lastNote > 30_000) {
      console.log(`  ..  still waiting for ${what} (${Math.round((Date.now() - started) / 1000)} s)`);
      lastNote = Date.now();
    }
    await Bun.sleep(everyMs);
  }
}

async function main(): Promise<void> {
  const coreDatabase = assertLocalDatabase("DATABASE_URL", process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/openbookings");
  process.env.SITEMINDER_DATABASE_URL = assertLocalDatabase("SITEMINDER_DATABASE_URL", process.env.SITEMINDER_DATABASE_URL ?? coreDatabase);

  const coreUrl = (process.env.CORE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const webUrl = (process.env.WEB_URL ?? "http://web.localhost:3002").replace(/\/+$/, "");
  const appPort = Number(process.env.PORT ?? 3006);
  const appUrl = `http://localhost:${appPort}`;
  const propertyId = process.env.E2E_PROPERTY_ID ?? "5eed1000-0000-4000-8000-000000000001"; // Canal Lantern Hotel
  const roomId = process.env.E2E_ROOM_ID ?? "5eed2000-0000-4000-8000-000000000001"; // Classic Double
  const ratePlanId = process.env.E2E_RATE_PLAN_ID ?? "5eed3000-0000-4000-8000-000000000001"; // Flexible
  const ownerEmail = process.env.E2E_OWNER_EMAIL ?? "owner@openbookings.test";

  // The fake SiteMinder first: the app must never send a reservation anywhere else.
  const { startFakeSiteMinder } = await import("../src/testing/fake-siteminder");
  const fake = startFakeSiteMinder({ port: Number(process.env.FAKE_SITEMINDER_PORT ?? 4011) });
  process.env.SITEMINDER_RESERVATION_URL = fake.url;
  const defaults: Record<string, string> = {
    SITEMINDER_INBOUND_USERNAME: "e2e-user",
    SITEMINDER_INBOUND_PASSWORD: "e2e-pass",
    SITEMINDER_RESERVATION_USERNAME: "e2e",
    SITEMINDER_RESERVATION_PASSWORD: "e2e",
    SITEMINDER_REQUESTOR_ID: "OBK",
    APP_SITEMINDER_REGISTRATION_SECRET: "local-registration-secret",
    SITEMINDER_TICK_SECRET: "local-tick-secret",
  };
  for (const [name, value] of Object.entries(defaults)) process.env[name] ||= value;
  process.env.SITEMINDER_RUN_MODE = "always-on";

  // Imported after the env is set.
  const { getPool } = await import("../src/db/pool");
  const { applyMigrations } = await import("../src/db/migrate");
  const { createApp } = await import("../src/index");
  const { startRunMode } = await import("../src/run-mode");
  const { defaultTickDeps } = await import("../src/tick");

  /** One core-side step, run by the business helper against the same local database. */
  async function core<T>(command: string, input: Record<string, unknown>): Promise<T> {
    const proc = Bun.spawn(["bun", "scripts/siteminder-e2e-core.ts", command, JSON.stringify(input)], {
      cwd: path.resolve(import.meta.dir, "../../business"),
      // Explicit values win over apps/business/.env.local, which bun also loads there. ENV_TYPE must not be
      // "dev" (that would select DEV_DATABASE_URL); an empty value would not override the file, so "local".
      env: {
        ...process.env,
        DATABASE_URL: coreDatabase,
        ENV_TYPE: "local",
        APP_SITEMINDER_URL: appUrl,
        APPS_API_BASE_URL: coreUrl,
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`core helper "${command}" failed (exit ${code})`);
    return parseHelperOutput(stdout) as T;
  }

  /** Send SiteMinder messages through replay.ts, as SiteMinder would. */
  async function replay(args: string[]): Promise<void> {
    const proc = Bun.spawn(["bun", "run", "scripts/replay.ts", "--url", `${appUrl}/soap`, ...args], {
      cwd: path.resolve(import.meta.dir, ".."),
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new CheckFailed(`replay ${args.join(" ")} did not get the right answers`);
  }

  const scratch = await mkdtemp(path.join(tmpdir(), "siteminder-e2e-"));
  let connected = false;
  let stopRunMode = () => {};
  let server: ReturnType<typeof Bun.serve> | undefined;

  const cleanUp = async () => {
    if (connected) {
      await core("disconnect", { propertyId, ownerEmail }).catch((e) => console.error(`  disconnect failed: ${e}`));
      connected = false;
    }
    stopRunMode();
    void server?.stop(true);
    fake.stop();
    await getPool().end().catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  };
  process.on("SIGINT", () => void cleanUp().finally(() => process.exit(130)));

  try {
    console.log("1. SiteMinder app and fake SiteMinder");
    await applyMigrations(getPool());
    server = Bun.serve({ port: appPort, fetch: createApp().fetch });
    stopRunMode = startRunMode(defaultTickDeps(), "always-on", 5);
    const coreAnswer = await fetch(`${coreUrl}/api/apps/v1/structure`).catch(() => null);
    check(coreAnswer?.status === 401, `core answers on ${coreUrl} (Apps API without a key: 401)`);

    console.log("2. Connect");
    const hotel = await core<Hotel>("connect", { propertyId, roomId, ratePlanId, ownerEmail });
    connected = true;
    check(/^[A-Z0-9]{6,20}$/.test(hotel.propertyCode), `connected, hotel code ${hotel.propertyCode}`);

    console.log("3. 750-day load");
    await replay(["--hotel", hotel.propertyCode, "--days", "750", "--room", hotel.roomCode, "--rate", hotel.rateCode, "--no-samples"]);
    // The bulk load sets a 2-night minimum; book far enough ahead to miss the seeded bookings.
    const checkIn = process.env.E2E_CHECK_IN ?? addDays(hotel.today, 40);
    const checkOut = addDays(checkIn, 2);
    const stay = { propertyId, roomId, checkIn, checkOut };
    const loaded = await waitFor(
      "SiteMinder's availability in core",
      async () => {
        const u = await core<Units>("units", stay);
        return u.nights.every((n) => n.limit !== null) ? u : null;
      },
      180_000,
    );
    const before = new Map(loaded.nights.map((n) => [n.date, n.bookable]));
    const limits = new Map(loaded.nights.map((n) => [n.date, n.limit!]));
    check(loaded.nights.every((n) => n.bookable >= 1), `${hotel.roomName} has rooms to sell: ${loaded.nights.map((n) => `${n.date} ${n.bookable}`).join(", ")}`);
    const minus = (map: ReadonlyMap<string, number>, n: number) => new Map([...map].map(([d, v]) => [d, v - n]));

    console.log("4. Booking");
    console.log(
      `\n  Book it now, in a browser:\n` +
        `    ${webUrl}/p/${hotel.slug}  (signed in as guest@openbookings.test)\n` +
        `    1 x ${hotel.roomName}, rate "${hotel.rateName}", ${checkIn} to ${checkOut}, 2 adults\n` +
        `    Pay with 4242 4242 4242 4242, any future expiry, any CVC.\n`,
    );
    const commit = await waitFor("the Commit at the fake SiteMinder", async () => findReservation(fake.received, { hotelCode: hotel.propertyCode, status: "Commit" }), 20 * 60_000, 2000);
    check(commit.start === checkIn && commit.end === checkOut, `Commit ${commit.uniqueId} for ${commit.start} to ${commit.end}`);
    const sent = await waitFor(
      'the booking to show "Sent"',
      async () => {
        const s = await core<Status>("status", { propertyId, uniqueId: commit.uniqueId });
        return s?.delivery?.status === "delivered" ? s : null;
      },
      120_000,
    );
    check(sent.badge?.label.startsWith("Sent") === true, `booking detail shows "${sent.badge?.label}"`);
    const ackAt = Date.parse(sent.delivery!.acknowledgedAt!);

    console.log("5. Availability");
    const afterBooking = await core<Units>("units", stay);
    const down = minus(before, 1);
    check(unitProblems(afterBooking.nights, down).length === 0, `one room fewer after the booking ${unitProblems(afterBooking.nights, down).join("; ")}`);

    const settleAt = ackAt + SETTLE_AFTER_ACK_MS + 15_000;
    if (Date.now() < settleAt) {
      console.log(`  ..  waiting ${Math.ceil((settleAt - Date.now()) / 1000)} s: SiteMinder's next limit must come 3 minutes after it took the booking`);
      await Bun.sleep(settleAt - Date.now());
    }
    /** SiteMinder's availability for the stay's nights, sent as SiteMinder would; waits until core holds it. */
    const sendLimits = async (wanted: ReadonlyMap<string, number>, label: string) => {
      const file = path.join(scratch, `${label}.xml`);
      const entries = [...wanted].map(([date, limit]) => ({ date, limit }));
      await writeFile(file, limitMessage({ hotelCode: hotel.propertyCode, room: hotel.roomCode, rate: hotel.rateCode, limits: entries }));
      await replay(["--hotel", hotel.propertyCode, "--keep-dates", file]);
      await waitFor(
        `core to hold the ${label} limits`,
        async () => {
          const u = await core<Units>("units", stay);
          return u.nights.every((n) => n.limit === wanted.get(n.date)) ? u : null;
        },
        60_000,
      );
    };
    // SiteMinder took the booking and lowered its own limit by one.
    await sendLimits(minus(limits, 1), "after-booking");
    const settled = await core<Units>("units", stay);
    check(unitProblems(settled.nights, down).length === 0, `still one room fewer with SiteMinder's new limit, not two ${unitProblems(settled.nights, down).join("; ")}`);

    console.log("6. Cancel");
    const cancelled = await core<{ ok: boolean; error?: string }>("cancel", { bookingId: sent.bookingId, ownerEmail });
    check(cancelled.ok, `host cancelled ${commit.uniqueId}${cancelled.error ? ` (${cancelled.error})` : ""}`);
    await waitFor("the Cancel at the fake SiteMinder", async () => findReservation(fake.received, { hotelCode: hotel.propertyCode, status: "Cancel", uniqueId: commit.uniqueId }), 120_000, 2000);
    await waitFor(
      "the cancellation to show as sent",
      async () => {
        const s = await core<Status>("status", { propertyId, uniqueId: commit.uniqueId });
        return s?.bookingStatus === "cancelled" && s.delivery?.status === "delivered" ? s : null;
      },
      120_000,
    );
    const afterCancel = await core<Units>("units", stay);
    check(unitProblems(afterCancel.nights, down).length === 0, `room not back until SiteMinder says so ${unitProblems(afterCancel.nights, down).join("; ")}`);
    // With Auto-Replenishment on, SiteMinder raises its limit again.
    await sendLimits(limits, "after-cancel");
    const replenished = await core<Units>("units", stay);
    check(unitProblems(replenished.nights, before).length === 0, `room back after SiteMinder's limit ${unitProblems(replenished.nights, before).join("; ")}`);

    console.log("7. Disconnect");
    await core("disconnect", { propertyId, ownerEmail });
    connected = false;
    check(true, "disconnected");
    console.log("\nPASS: Commit and Cancel delivered; availability went down once and came back with SiteMinder's limit.");
  } catch (e) {
    console.error(`\nFAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await cleanUp();
  }
}

if (import.meta.main) {
  await main();
  process.exit(process.exitCode ?? 0);
}
