import { describe, expect, test } from "bun:test";
import { evaluateReadiness, isReady, NOT_STARTED } from "./readiness";

const READY = { listingLive: true, availabilityOpen: true, hasActiveRatePlan: true, paymentsConnected: true };

describe("evaluateReadiness", () => {
  test("four items, in the order a host fixes them, each with somewhere to go", () => {
    const items = evaluateReadiness(NOT_STARTED);
    expect(items.map((i) => i.label)).toEqual([
      "Listing is live",
      "Availability is open for the next 90 days",
      "At least one active rate plan",
      "Payments connected",
    ]);
    expect(items.every((i) => i.state === "todo" && i.href.startsWith("/"))).toBe(true);
    expect(isReady(items)).toBe(false);
  });

  test("all four done means ready", () => {
    expect(isReady(evaluateReadiness(READY))).toBe(true);
  });

  test("one open item is enough to not be ready", () => {
    const items = evaluateReadiness({ ...READY, hasActiveRatePlan: false });
    expect(items.map((i) => i.state)).toEqual(["done", "done", "todo", "done"]);
    expect(isReady(items)).toBe(false);
  });

  test("a Stripe lookup that failed is unknown, not a false accusation", () => {
    const items = evaluateReadiness({ ...READY, paymentsConnected: null });
    expect(items[3].state).toBe("unknown");
    expect(isReady(items)).toBe(false);
  });
});
