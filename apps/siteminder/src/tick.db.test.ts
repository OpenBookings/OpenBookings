import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { type AriBatch, type AriResult, type InventoryChange, MAX_ARI_CHANGES } from "@openbookings/apps-contract";
import { type CoreClient, CoreApiError } from "./core-client";
import type { Queryable } from "./db/migrate";
import { storeInbound } from "./inbox";
import { type AppInstallation, upsertInstallation } from "./installations";
import { serialized, skipDbTests, withTestDb } from "./testing/db-harness";
import { MAX_BATCH_NIGHTS, type TickDeps, tick } from "./tick";

const reg = {
  installationId: "4c1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c71",
  propertyCode: "SM-TICK-2031",
  propertyName: "Hotel Tick",
  apiKey: "key-tick",
  coreBaseUrl: "https://core.example",
};
const other = { ...reg, installationId: "4c1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c72", propertyCode: "SM-TICK2-2031", apiKey: "key-tick-2" };
const T0 = new Date("2031-04-01T08:00:00.000Z");

/** A clock the test moves; `sleep` moves it too and records the wait. */
function fakeClock(start = T0) {
  const clock = {
    t: start.getTime(),
    slept: [] as number[],
    now: () => new Date(clock.t),
    advance: (ms: number) => { clock.t += ms; },
    sleep: async (ms: number) => { clock.slept.push(ms); clock.t += ms; },
  };
  return clock;
}

type Call = { installationId: string; batch: AriBatch };
type Reply = AriResult | Error | ((batch: AriBatch) => Promise<AriResult>);

/** Core's ARI endpoint: records every batch; replies from a queue, then `{ ok: true }`. */
function fakeCore(replies: Reply[] = []) {
  const calls: Call[] = [];
  const client = (inst: AppInstallation) =>
    ({
      writeAri: async (batch: AriBatch): Promise<AriResult> => {
        calls.push({ installationId: inst.id, batch });
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        if (typeof reply === "function") return reply(batch);
        return reply ?? { ok: true, nights: 0 };
      },
    }) as unknown as CoreClient;
  return { calls, client };
}

const deps = (db: Queryable, core: ReturnType<typeof fakeCore>, clock: ReturnType<typeof fakeClock>): TickDeps => ({
  db, client: core.client, now: clock.now, sleep: clock.sleep,
});

const inv = (roomCode: string, from = "2031-05-01", to = from, unitsLeft = 1): InventoryChange => ({ roomCode, from, to, unitsLeft });

async function queue(db: Queryable, changes: Partial<AriBatch>, now: Date, installationId = reg.installationId): Promise<string> {
  const echoToken = crypto.randomUUID();
  await storeInbound(db, { installationId, echoToken, kind: "HotelAvailNotifRQ", changes, now });
  return echoToken;
}

type InboxRow = { echo_token: string; processed_at: Date | null; attempts: number; next_attempt_at: Date | null; last_error: string | null };
async function inbox(db: Queryable): Promise<InboxRow[]> {
  return (await db.query<InboxRow>(`SELECT echo_token, processed_at, attempts, next_attempt_at, last_error FROM siteminder.inbox ORDER BY id`)).rows;
}

const rooms = (call: Call) => call.batch.inventory.map((c) => c.roomCode);
const SHORT = { budgetMs: 1_000 };

describe.skipIf(skipDbTests)("tick (rolled back)", () => {
  const logged: { error: unknown[][]; warn: unknown[][] } = { error: [], warn: [] };
  const spies = [
    spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.error.push(args); }),
    spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logged.warn.push(args); }),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
  beforeAll(() => { logged.error.length = 0; logged.warn.length = 0; });
  afterAll(() => { for (const s of spies) s.mockRestore(); });
  const clearLogs = () => { logged.error.length = 0; logged.warn.length = 0; };

  it("posts one merged batch for three queued messages, in order, and marks them processed", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("RA")] }, T0);
      await queue(db, { rates: [{ ratePlanCode: "PB", from: "2031-05-01", to: "2031-05-02", priceCents: 18650, extraAdultCents: null, extraChildCents: null }] }, T0);
      await queue(db, { inventory: [inv("RB")], restrictions: [{ ratePlanCode: "PB", from: "2031-05-01", to: "2031-05-01", closedToArrival: true }] }, T0);
      const core = fakeCore();

      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 3, inboxFailed: 0 });
      expect(core.calls).toHaveLength(1);
      expect(core.calls[0]!.batch).toEqual({
        inventory: [inv("RA"), inv("RB")],
        rates: [{ ratePlanCode: "PB", from: "2031-05-01", to: "2031-05-02", priceCents: 18650, extraAdultCents: null, extraChildCents: null }],
        restrictions: [{ ratePlanCode: "PB", from: "2031-05-01", to: "2031-05-01", closedToArrival: true }],
        receivedAt: T0.toISOString(),
      });
      expect((await inbox(db)).map((r) => r.processed_at)).toEqual([T0, T0, T0]);

      // Nothing left: the next tick posts nothing.
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 0 });
      expect(core.calls).toHaveLength(1);
    });
  });

  it("sends the earliest received time of the merged messages as receivedAt", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const clock = fakeClock(new Date(T0.getTime() + 600_000));
      await queue(db, { inventory: [inv("RA")] }, new Date(T0.getTime() + 2_000));
      await queue(db, { inventory: [inv("RB")] }, T0); // a clock step back: id order still rules, the time is still the earliest
      await queue(db, { inventory: [inv("RC")] }, new Date(T0.getTime() + 4_000));
      const core = fakeCore();
      await tick(deps(db, core, clock), SHORT);
      expect(core.calls).toHaveLength(1);
      expect(rooms(core.calls[0]!)).toEqual(["RA", "RB", "RC"]);
      expect(core.calls[0]!.batch.receivedAt).toBe(T0.toISOString());
    });
  });

  it("splits a merge over the nights cap, in order, each part with its own earliest time", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const clock = fakeClock(new Date(T0.getTime() + 600_000));
      // 70 messages of one 750-night change each: 52 500 nights, more than one POST may carry.
      for (let i = 0; i < 70; i++) {
        await queue(db, { inventory: [inv(`R${i}`, "2031-01-01", "2033-01-19")] }, new Date(T0.getTime() + i * 1000));
      }
      const core = fakeCore();
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 70, inboxFailed: 0 });

      const nights = (b: AriBatch) => b.inventory.length * 750;
      expect(core.calls.map((c) => nights(c.batch))).toEqual([66 * 750, 4 * 750]);
      for (const c of core.calls) expect(nights(c.batch)).toBeLessThanOrEqual(MAX_BATCH_NIGHTS);
      expect(core.calls.flatMap(rooms)).toEqual(Array.from({ length: 70 }, (_, i) => `R${i}`));
      expect(core.calls[1]!.batch.receivedAt).toBe(new Date(T0.getTime() + 66_000).toISOString());
    });
  });

  it("splits one message over MAX_ARI_CHANGES across batches and marks it processed only when its last part is in", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      const big = Array.from({ length: MAX_ARI_CHANGES + 1 }, (_, i) => inv(`RBIG${i}`));
      await queue(db, { inventory: big }, T0);
      await queue(db, { inventory: [inv("RAFTER")] }, T0);
      // The second part fails: neither message is done.
      const core = fakeCore([{ ok: true, nights: 0 }, new CoreApiError("down", "server", 500, true)]);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 2 });
      expect(core.calls.map((c) => c.batch.inventory.length)).toEqual([MAX_ARI_CHANGES, 2]);
      expect(rooms(core.calls[1]!)).toEqual([`RBIG${MAX_ARI_CHANGES}`, "RAFTER"]);
      expect((await inbox(db)).map((r) => r.processed_at)).toEqual([null, null]);

      // Retried whole, in order.
      clock.advance(5_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 2, inboxFailed: 0 });
      expect(core.calls.slice(2).flatMap(rooms)).toEqual([...big.map((c) => c.roomCode), "RAFTER"]);
    });
  });

  it("a core 500 schedules a retry at +5 s; the next tick after that sends it", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("RA")] }, T0);
      const core = fakeCore([new CoreApiError("core /ari answered 500", "server", 500, true)]);

      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 1 });
      expect(await inbox(db)).toMatchObject([{ processed_at: null, attempts: 1, next_attempt_at: new Date(T0.getTime() + 5_000), last_error: "core /ari answered 500" }]);
      expect(clock.slept).toEqual([]); // 5 s does not fit a 1 s budget: left for the next tick

      clock.advance(4_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 0 });
      expect(core.calls).toHaveLength(1);

      clock.advance(1_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 1, inboxFailed: 0 });
      expect(core.calls).toHaveLength(2);
      expect(await inbox(db)).toMatchObject([{ processed_at: new Date(T0.getTime() + 5_000), last_error: null }]);
    });
  });

  it("retries after 5, 15, 30, 60 s (inline while the budget allows) and reports the 5th failure", async () => {
    await withTestDb(async (db) => {
      clearLogs();
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("RA")] }, T0);
      const down = () => new CoreApiError("core /ari answered 503", "conflict", 503, true);
      const core = fakeCore([down(), down(), down(), down(), down()]);

      // 0 s fails, waits 5 s, fails, waits 15 s, fails; the 30 s wait would use up the rest of the 50 s budget.
      expect(await tick(deps(db, core, clock), { budgetMs: 50_000 })).toEqual({ inboxApplied: 0, inboxFailed: 3 });
      expect(clock.slept).toEqual([5_000, 15_000]);
      expect(await inbox(db)).toMatchObject([{ attempts: 3, next_attempt_at: new Date(T0.getTime() + 50_000) }]);

      clock.advance(30_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 1 });
      expect(await inbox(db)).toMatchObject([{ attempts: 4, next_attempt_at: new Date(T0.getTime() + 110_000) }]);
      expect(logged.error).toHaveLength(0);

      clock.advance(60_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 1 });
      expect(await inbox(db)).toMatchObject([{ attempts: 5, processed_at: null }]);
      expect(logged.error).toHaveLength(1);
      expect(String(logged.error[0]![0])).toContain("failed 5 times");

      // Still kept and retried (every 60 s) until core takes it.
      clock.advance(60_000);
      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 1, inboxFailed: 0 });
    });
  });

  it("a 422 (unknown codes) is permanent for that message only; the messages around it still go in, in order", async () => {
    await withTestDb(async (db) => {
      clearLogs();
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("RA")] }, T0);
      await queue(db, { inventory: [inv("RNOPE")] }, T0);
      await queue(db, { inventory: [inv("RC")] }, T0);
      const unknownCodes = (b: AriBatch) => b.inventory.map((c) => c.roomCode).filter((code) => code === "RNOPE");
      const core = fakeCore(Array.from({ length: 4 }, () => async (b: AriBatch): Promise<AriResult> =>
        unknownCodes(b).length ? { ok: false, error: "unknown codes", unknownCodes: unknownCodes(b) } : { ok: true, nights: 1 }));

      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 2, inboxFailed: 1 });
      expect(core.calls.map(rooms)).toEqual([["RA", "RNOPE", "RC"], ["RA"], ["RNOPE"], ["RC"]]);
      expect(await inbox(db)).toMatchObject([
        { processed_at: T0, last_error: null },
        { processed_at: T0, last_error: "unknown codes: RNOPE" },
        { processed_at: T0, last_error: null },
      ]);
      expect(logged.warn.some((args) => String(args[0]).includes("unknown codes"))).toBe(true);
    });
  });

  it("a permanent error (401) marks the message failed and alerts, never retrying it", async () => {
    await withTestDb(async (db) => {
      clearLogs();
      await upsertInstallation(db, reg);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("RA")] }, T0);
      const core = fakeCore([new CoreApiError("core /ari answered 401", "unauthorized", 401, false)]);

      expect(await tick(deps(db, core, clock), SHORT)).toEqual({ inboxApplied: 0, inboxFailed: 1 });
      expect(await inbox(db)).toMatchObject([{ processed_at: T0, last_error: "core /ari answered 401" }]);
      expect(logged.error).toHaveLength(1);
      clock.advance(3_600_000);
      await tick(deps(db, core, clock), SHORT);
      expect(core.calls).toHaveLength(1);
    });
  });

  it("concurrent ticks never apply one installation's messages out of order; other installations go in parallel", async () => {
    await withTestDb(async (connection) => {
      const db = serialized(connection);
      await upsertInstallation(db, reg);
      await upsertInstallation(db, other);
      const clock = fakeClock();
      await queue(db, { inventory: [inv("R1")] }, T0);
      await queue(db, { inventory: [inv("R2")] }, T0);
      await queue(db, { inventory: [inv("S1")] }, T0, other.installationId);

      // Core is slow on the first batch: while it is in flight, more messages arrive and more ticks start.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let entered!: () => void;
      const inFlight = new Promise<void>((resolve) => { entered = resolve; });
      const calls: Call[] = [];
      const active = new Map<string, number>();
      let maxPerInstallation = 0;
      const client = (inst: AppInstallation) =>
        ({
          writeAri: async (batch: AriBatch): Promise<AriResult> => {
            calls.push({ installationId: inst.id, batch });
            const n = (active.get(inst.id) ?? 0) + 1;
            active.set(inst.id, n);
            maxPerInstallation = Math.max(maxPerInstallation, n);
            try {
              if (batch.inventory.some((c) => c.roomCode === "R1")) {
                entered();
                await gate;
              }
              return { ok: true, nights: 1 };
            } finally {
              active.set(inst.id, n - 1);
            }
          },
        }) as unknown as CoreClient;
      const d: TickDeps = { db, client, now: clock.now, sleep: clock.sleep };

      const first = tick(d, SHORT);
      await inFlight;
      await queue(db, { inventory: [inv("R3")] }, T0);
      const second = tick(d, { ...SHORT, installationId: reg.installationId });
      const third = tick(d, SHORT);
      const [secondResult, thirdResult] = await Promise.all([second, third]);
      release();
      const firstResult = await first;

      // The later ticks skipped the busy installation (they returned while its batch was still in flight);
      // the first tick picked up the message that arrived meanwhile after its batch was in.
      expect(calls.filter((c) => c.installationId === reg.installationId).map(rooms)).toEqual([["R1", "R2"], ["R3"]]);
      expect(maxPerInstallation).toBe(1);
      expect(calls.filter((c) => c.installationId === other.installationId).flatMap(rooms)).toEqual(["S1"]);
      expect(firstResult.inboxApplied + secondResult.inboxApplied + thirdResult.inboxApplied).toBe(4);
      expect((await inbox(db)).every((r) => r.processed_at !== null)).toBe(true);
    });
  });

  it("warns when the oldest unprocessed message is over 10 minutes old", async () => {
    await withTestDb(async (db) => {
      clearLogs();
      await upsertInstallation(db, reg);
      const clock = fakeClock(new Date(T0.getTime() + 11 * 60_000));
      await queue(db, { inventory: [inv("RA")] }, T0);
      const core = fakeCore([new CoreApiError("down", "network", null, true)]);
      await tick(deps(db, core, clock), SHORT);
      expect(logged.warn.some((args) => String(args[0]).includes("oldest unprocessed"))).toBe(true);
    });
  });
});
