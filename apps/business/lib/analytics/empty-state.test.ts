import { describe, expect, test } from "bun:test";
import { blockers, filteredAction, neverBookedVariant, nextStep } from "./empty-state";
import { evaluateReadiness, NOT_STARTED } from "./readiness";

const READY = { listingLive: true, availabilityOpen: true, hasActiveRatePlan: true, paymentsConnected: true };
const PATH = "/dashboard/analytics/revenue";

describe("neverBookedVariant", () => {
  test("a listing that is not published is not live", () => {
    expect(neverBookedVariant(evaluateReadiness({ ...READY, listingLive: false }))).toBe("not-live");
  });

  test("a published listing without payments is not live, and payments is the named blocker", () => {
    const readiness = evaluateReadiness({ ...READY, paymentsConnected: false });
    expect(neverBookedVariant(readiness)).toBe("not-live");
    expect(blockers(readiness).map((item) => item.key)).toEqual(["payments"]);
  });

  test("everything set up and still no bookings is live", () => {
    expect(neverBookedVariant(evaluateReadiness(READY))).toBe("no-bookings");
  });

  test("closed dates or a missing rate plan do not make a published listing not live", () => {
    const readiness = evaluateReadiness({ ...READY, availabilityOpen: false, hasActiveRatePlan: false });
    expect(neverBookedVariant(readiness)).toBe("no-bookings");
  });

  test("a Stripe lookup that failed is not a blocker", () => {
    const readiness = evaluateReadiness({ ...READY, paymentsConnected: null });
    expect(neverBookedVariant(readiness)).toBe("no-bookings");
    expect(blockers(readiness)).toEqual([]);
  });
});

describe("nextStep", () => {
  test("the first blocker comes before an earlier step that only makes bookings less likely", () => {
    const readiness = evaluateReadiness({ ...READY, availabilityOpen: false, paymentsConnected: false });
    expect(nextStep(readiness)?.key).toBe("payments");
  });

  test("with no blocker it is the first open step", () => {
    expect(nextStep(evaluateReadiness({ ...READY, hasActiveRatePlan: false }))?.key).toBe("rate-plan");
  });

  test("a host who has not started begins with the listing", () => {
    expect(nextStep(evaluateReadiness(NOT_STARTED))?.key).toBe("listing");
  });

  test("nothing known to be open is no step", () => {
    expect(nextStep(evaluateReadiness(READY))).toBeNull();
    expect(nextStep(evaluateReadiness({ ...READY, paymentsConnected: null }))).toBeNull();
  });
});

describe("filteredAction", () => {
  test("a narrowed period resets to the default and keeps everything else", () => {
    const search = new URLSearchParams("period=custom&from=2026-01-01&to=2026-01-07&compare=none&demo=1");
    expect(filteredAction(PATH, search)).toEqual({
      label: "Reset filters",
      href: `${PATH}?compare=none&demo=1`,
    });
  });

  test("the default period has nothing to reset, so it widens", () => {
    const widen = { label: "Show last 12 months", href: `${PATH}?period=last-12-months` };
    expect(filteredAction(PATH, new URLSearchParams())).toEqual(widen);
    expect(filteredAction(PATH, new URLSearchParams("period=last-3-months"))).toEqual(widen);
  });

  test("resetting to no params at all is the bare path", () => {
    expect(filteredAction(PATH, new URLSearchParams("period=last-7-days")).href).toBe(PATH);
  });
});
