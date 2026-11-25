import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

type Row = { installationId: string; bookingId: string; propertyId: string; appKey: string; detail: string | null };
const row = (bookingId: string): Row => ({ installationId: "i1", bookingId, propertyId: "p1", appKey: "siteminder", detail: "Not confirmed" });

let flagged: Row[] = [];
let unmailed: Row[] = [];
/** What the alert does per booking: sent, failed (mail down) or skipped (mailed already). */
let outcomes: Record<string, "sent" | "failed" | "skipped"> = {};
const alerts: string[] = [];

await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({ getPool: () => ({}) }),
  "@openbookings/db/apps": () => ({
    flagUnconfirmedDeliveries: async () => flagged,
    unmailedAlerts: async (_db: unknown, _now: Date, limit: number) => unmailed.slice(0, limit),
  }),
  "@/lib/apps/delivery-alert": () => ({
    alertDeliveryNeedsAttention: async (_db: unknown, i: Row) => {
      alerts.push(i.bookingId);
      return outcomes[i.bookingId] ?? "sent";
    },
  }),
});

const { POST } = await import("./route");

const cron = (headers: Record<string, string> = { authorization: "Bearer test-cron-secret" }) =>
  new Request("http://localhost/api/cron/app-delivery-watchdog", { method: "POST", headers });

describe("app delivery watchdog", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    flagged = [];
    unmailed = [];
    outcomes = {};
    alerts.length = 0;
  });

  test("alerts each newly flagged booking, then the older unmailed ones, one by one", async () => {
    flagged = [row("b1"), row("b2")];
    unmailed = [row("b3"), row("b4")];
    outcomes = { b2: "skipped", b4: "failed" }; // b2 mailed by the route meanwhile; b4's mail is down
    const res = await POST(cron());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, flagged: 2, mailed: 2, failed: 1 });
    expect(alerts).toEqual(["b1", "b2", "b3", "b4"]);
  });

  test("takes at most 50 older unmailed alerts a run", async () => {
    unmailed = Array.from({ length: 80 }, (_, n) => row(`old-${n}`));
    expect(await (await POST(cron())).json()).toMatchObject({ mailed: 50 });
  });

  test("requires the cron secret", async () => {
    flagged = [row("b1")];
    expect((await POST(cron({}))).status).toBe(401);
    expect((await POST(cron({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(alerts).toEqual([]);
  });
});
