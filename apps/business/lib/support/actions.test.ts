import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
let scope: { userId: string } | null = { userId: "host-1" };
let markSeenError: unknown = null;

class SupportError extends Error {}

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "@openbookings/mailing/tracking": () => ({
    captureOutcome: async (...args: unknown[]) => {
      captured.push(args);
    },
  }),
  "@/lib/rateLimit": () => ({ checkRateLimit: () => ({ allowed: true }) }),
  "./server/bootstrap": () => ({ currentSupportScope: async () => scope }),
  "./server/service": () => ({
    loadTicket: async () => ({}),
    markSeen: async () => {
      if (markSeenError) throw markSeenError;
    },
    pubsubTokenFor: async () => null,
    requestPerson: async () => ({}),
    resolveTicket: async () => ({}),
    setTyping: async () => {},
    SupportError,
  }),
  "./server/tickets": () => ({ panelTickets: async () => [], searchLinkables: async () => [] }),
});

const { markSeenAction } = await import("./actions");

beforeEach(() => {
  captured.length = 0;
  scope = { userId: "host-1" };
  markSeenError = null;
});

describe("markSeenAction outcome event", () => {
  it("captures support_thread_viewed for the signed-in member", async () => {
    expect(await markSeenAction("t1")).toEqual({ ok: true, data: undefined });
    expect(captured).toEqual([["support_thread_viewed", { userId: "host-1" }]]);
  });

  it("captures nothing without a support scope or when marking fails", async () => {
    scope = null;
    await markSeenAction("t1");
    scope = { userId: "host-1" };
    markSeenError = new SupportError("nope");
    await markSeenAction("t1");
    expect(captured).toEqual([]);
  });
});
