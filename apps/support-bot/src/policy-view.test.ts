import { describe, expect, it } from "bun:test";
import { policyView } from "./policy-view";

const snapshotted = {
  cancellation_tier: "flex" as const,
  check_in_at: "2026-11-10T14:00:00+00:00",
  full_refund_until: "2026-11-09T14:00:00+00:00",
  cancelled_at: null,
};
const NOW = new Date("2026-10-20T10:00:00Z");

describe("policyView", () => {
  it("names the Annex B tier and states the booked deadlines as local dates", () => {
    expect(policyView(snapshotted, "Europe/Amsterdam", "2026-10-01T10:00:00+00:00", NOW)).toEqual({
      tier: "Flex",
      terms: "Free cancellation until 24 hours before check-in. After that, the room price isn't refunded.",
      deadlines: [
        "Free cancellation until Mon 9 Nov 2026, 15:00.",
        "After that, the room price isn't refunded.",
        "If you leave early, the next 7 nights are charged and any nights after that are refunded.",
        "Tourist tax is refunded for nights you don't stay.",
        "If you don't show up, nothing is refunded.",
      ],
      no_show: "If you don't show up, nothing is refunded.",
      cancelled_at: null,
    });
  });

  it("a non-refundable room is Non-refundable", () => {
    const view = policyView({ ...snapshotted, cancellation_tier: "non_refundable", full_refund_until: null }, "Europe/Amsterdam", null, NOW);
    expect(view.tier).toBe("Non-refundable");
  });

  it("a booking not yet confirmed has no deadlines to quote", () => {
    const view = policyView({ ...snapshotted, check_in_at: null, full_refund_until: null }, "Europe/Amsterdam", null, NOW);
    expect(view.deadlines).toBeNull();
  });
});
