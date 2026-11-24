import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
const refundMails: unknown[][] = [];
let lifecycle: unknown = { ok: true, refunds: [] };
const goodwillCalls: unknown[] = [];

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/cache": () => ({ revalidatePath: () => {} }),
  "@sentry/nextjs": () => ({ captureException: () => {} }),
  "@openbookings/authz": () => ({
    userCan: async () => true,
    // The booking's hotel (h1) is the session's current one, already stored.
    resolveCurrentProperty: async () => ({
      current: { propertyId: "h1", organizationId: "o1" },
      stored: { activePropertyId: "h1", activeOrganizationId: "o1" },
    }),
    listSwitchableProperties: async () => [],
    setCurrentProperty: async () => null,
  }),
  "@openbookings/db": () => ({ queryOne: async () => ({ hotel_id: "h1" }) }),
  "@openbookings/db/booking-lifecycle": () => ({
    cancelRooms: async () => lifecycle,
    issueGoodwillRefund: async (_deps: unknown, i: unknown) => {
      goodwillCalls.push(i);
      return lifecycle;
    },
    markCheckedIn: async () => lifecycle,
    markNoShow: async () => lifecycle,
    previewRefund: async () => lifecycle,
    recordEarlyDeparture: async () => lifecycle,
    retryRefunds: async () => lifecycle,
  }),
  "@openbookings/stripe": () => ({
    findRefundForRow: async () => null,
    isDefiniteRefundFailure: () => false,
    refundPayment: async () => ({}),
  }),
  "@openbookings/mailing/tracking": () => ({
    captureOutcome: async (...args: unknown[]) => {
      captured.push(args);
    },
  }),
  "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => ({ user: { id: "host-1" }, session: { id: "s1" } }) }),
  "@/lib/mailing/booking-mail": () => ({
    sendCancellation: async () => {},
    sendRefundMail: async (...args: unknown[]) => {
      refundMails.push(args);
    },
  }),
}, ["@/lib/auth"]);

const { hostGoodwillRefund, hostMarkCheckedIn, hostRecordEarlyDeparture, hostRetryRefunds } = await import("./actions");

beforeEach(() => {
  captured.length = 0;
  refundMails.length = 0;
  goodwillCalls.length = 0;
  lifecycle = { ok: true, refunds: [] };
});

describe("hostMarkCheckedIn outcome event", () => {
  it("captures stay_marked_arrived for the host on success", async () => {
    await hostMarkCheckedIn("b1");
    expect(captured).toEqual([["stay_marked_arrived", { userId: "host-1" }]]);
  });

  it("captures nothing when the lifecycle refuses", async () => {
    lifecycle = { ok: false, error: "not_allowed" };
    await hostMarkCheckedIn("b1");
    expect(captured).toEqual([]);
  });
});

describe("refund mails outside a cancellation", () => {
  const refunds = [{ reservationId: null, amountCents: 2_000, status: "succeeded" }];

  it("mails the guest after an early departure, a goodwill refund and a retry, with what Stripe did", async () => {
    lifecycle = { ok: true, refunds };
    await hostRecordEarlyDeparture("b1", "2031-11-10");
    await hostGoodwillRefund("b1", "20");
    await hostRetryRefunds("b1");
    expect(refundMails).toEqual([
      ["b1", "early_departure", refunds],
      ["b1", "goodwill", refunds],
      ["b1", "retry", refunds],
    ]);
  });

  it("mails nothing when the lifecycle refuses", async () => {
    lifecycle = { ok: false, error: "not_allowed" };
    await hostGoodwillRefund("b1", "20");
    expect(refundMails).toEqual([]);
  });
});

describe("hostGoodwillRefund amount", () => {
  it('refunds "12,50" as 1250 cents', async () => {
    expect(await hostGoodwillRefund("b1", "12,50")).toEqual({ ok: true, refunds: [] });
    expect(goodwillCalls).toEqual([{ bookingId: "b1", actor: { kind: "host", userId: "host-1" }, amountCents: 1250 }]);
  });

  it("refuses an amount it can't read, before the lifecycle is asked", async () => {
    for (const bad of ["abc", "0", "12.505", 12.5 as unknown as string]) {
      expect(await hostGoodwillRefund("b1", bad)).toEqual({ ok: false, error: "invalid_amount" });
    }
    expect(goodwillCalls).toEqual([]);
  });
});
