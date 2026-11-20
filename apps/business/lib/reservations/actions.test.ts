import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
const refundMails: unknown[][] = [];
let lifecycle: unknown = { ok: true, refunds: [] };
let goodwillCalls = 0;

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/cache": () => ({ revalidatePath: () => {} }),
  "@sentry/nextjs": () => ({ captureException: () => {} }),
  "@openbookings/authz": () => ({ userCan: async () => true }),
  "@openbookings/db": () => ({ queryOne: async () => ({ hotel_id: "h1" }) }),
  "@openbookings/db/booking-lifecycle": () => ({
    cancelRooms: async () => lifecycle,
    issueGoodwillRefund: async () => {
      goodwillCalls++;
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
  "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => ({ user: { id: "host-1" } }) }),
  "@/lib/mailing/booking-mail": () => ({
    sendCancellation: async () => {},
    sendRefundMail: async (...args: unknown[]) => {
      refundMails.push(args);
    },
  }),
}, ["@/lib/auth"]);

const actions = await import("./actions");
const { hostMarkCheckedIn, hostRecordEarlyDeparture, hostRetryRefunds } = actions;

beforeEach(() => {
  captured.length = 0;
  refundMails.length = 0;
  goodwillCalls = 0;
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
  const refunds = [{ reservationId: null, amount: 20, status: "succeeded" }];

  it("mails the guest after an early departure and a retry, with what Stripe did", async () => {
    lifecycle = { ok: true, refunds };
    await hostRecordEarlyDeparture("b1", "2031-11-10");
    await hostRetryRefunds("b1");
    expect(refundMails).toEqual([
      ["b1", "early_departure", refunds],
      ["b1", "retry", refunds],
    ]);
  });

  it("mails nothing when the lifecycle refuses", async () => {
    lifecycle = { ok: false, error: "not_allowed" };
    await hostRecordEarlyDeparture("b1", "2031-11-10");
    expect(refundMails).toEqual([]);
  });
});

describe("goodwill refunds", () => {
  // Owner decision 2026-11-20: hosts request goodwill refunds through support;
  // only OpenBookings staff issue them (admin app). Even a host whose role
  // passes every check gets no server action that issues one.
  it("no host server action issues a goodwill refund", async () => {
    expect(Object.keys(actions).filter((name) => /goodwill/i.test(name))).toEqual([]);
    for (const [name, action] of Object.entries(actions)) {
      if (typeof action !== "function") continue;
      await (action as (...args: unknown[]) => Promise<unknown>)("b1", name === "hostRecordEarlyDeparture" ? "2031-11-10" : null, 20);
    }
    expect(goodwillCalls).toBe(0);
  });
});
