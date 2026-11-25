import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

type Row = { installationId: string; bookingId: string; propertyId: string; appKey: string; detail: string | null };
const row = (bookingId: string): Row => ({ installationId: "i1", bookingId, propertyId: "p1", appKey: "siteminder", detail: "Not confirmed" });

let flagged: Row[] = [];
let unmailed: Row[] = [];
let claimable = new Set<string>();
const alerts: string[] = [];

await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({ getPool: () => ({}) }),
  "@openbookings/db/apps": () => ({
    flagUnconfirmedDeliveries: async () => flagged,
    claimAlert: async (_db: unknown, i: { bookingId: string }) => claimable.delete(i.bookingId),
    claimUnmailedAlerts: async () => unmailed,
  }),
  "@/lib/apps/delivery-alert": () => ({
    alertDeliveryNeedsAttention: async (i: Row) => {
      alerts.push(i.bookingId);
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
    claimable = new Set();
    alerts.length = 0;
  });

  test("mails each newly flagged booking it can claim, then every unmailed one", async () => {
    flagged = [row("b1"), row("b2")];
    claimable = new Set(["b1"]); // b2 was mailed by someone else meanwhile
    unmailed = [row("b3")];
    const res = await POST(cron());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, flagged: 2, mailed: 2 });
    expect(alerts).toEqual(["b1", "b3"]);
  });

  test("requires the cron secret", async () => {
    flagged = [row("b1")];
    expect((await POST(cron({}))).status).toBe(401);
    expect((await POST(cron({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(alerts).toEqual([]);
  });
});
