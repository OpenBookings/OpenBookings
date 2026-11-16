import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
let lifecycle: unknown = { ok: true, refunds: [] };

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/cache": () => ({ revalidatePath: () => {} }),
  "@sentry/nextjs": () => ({ captureException: () => {} }),
  "@openbookings/authz": () => ({ userCan: async () => true }),
  "@openbookings/db": () => ({ queryOne: async () => ({ hotel_id: "h1" }) }),
  "@openbookings/db/booking-lifecycle": () => ({
    cancelRooms: async () => lifecycle,
    issueGoodwillRefund: async () => lifecycle,
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
  "@/lib/mailing/booking-mail": () => ({ sendCancellation: async () => {} }),
}, ["@/lib/auth"]);

const { hostMarkCheckedIn } = await import("./actions");

beforeEach(() => {
  captured.length = 0;
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
