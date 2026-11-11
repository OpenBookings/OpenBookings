import { describe, expect, test } from "bun:test";
import { buildPolicySnapshot, type CancellationTier } from "./cancellation";
import { describePolicy, describePolicySteps, formatDeadline, TIER_LABELS, TIER_SUMMARIES } from "./cancellation-copy";

const TZ = "Europe/Amsterdam";
const snapshot = (tier: CancellationTier) =>
  buildPolicySnapshot({
    tier,
    timeZone: TZ,
    checkInTime: "15:00",
    arrivalDate: "2026-11-10",
    confirmedAt: new Date("2026-10-01T10:00:00Z"),
  });
/** Well before any deadline. */
const EARLY = new Date("2026-10-05T10:00:00Z");

const EARLY_LINE = "If you leave early, the next 7 nights are charged and any nights after that are refunded.";
const TAX_LINE = "Tourist tax is refunded for nights you don't stay.";
const NO_SHOW_LINE = "If you don't show up, nothing is refunded.";

describe("labels", () => {
  test("the three tier names", () => {
    expect(TIER_LABELS).toEqual({ flex: "Flex", standard: "Standard", non_refundable: "Non-refundable" });
  });

  test("every tier has a one-line summary", () => {
    expect(TIER_SUMMARIES.flex).toBe(
      "Free cancellation until 24 hours before check-in. After that, the room price isn't refunded.",
    );
    expect(TIER_SUMMARIES.standard).toBe(
      "Free cancellation until 7 days before check-in. After that, the room price isn't refunded.",
    );
    expect(Object.keys(TIER_SUMMARIES).sort()).toEqual(["flex", "non_refundable", "standard"]);
  });
});

describe("formatDeadline", () => {
  test("an exact local date and time", () => {
    expect(formatDeadline(new Date("2026-11-03T14:00:00Z"), TZ)).toBe("Tue 3 Nov 2026, 15:00");
  });

  test("uses the property's zone, not the server's", () => {
    expect(formatDeadline(new Date("2026-11-03T14:00:00Z"), "Europe/Lisbon")).toBe("Tue 3 Nov 2026, 14:00");
  });
});

describe("describePolicy", () => {
  test("Flex: the deadline, what happens after, leaving early, tourist tax and no-shows", () => {
    expect(describePolicy(snapshot("flex"), TZ, EARLY)).toEqual([
      "Free cancellation until Mon 9 Nov 2026, 15:00.",
      "After that, the room price isn't refunded.",
      EARLY_LINE,
      TAX_LINE,
      NO_SHOW_LINE,
    ]);
  });

  test("Standard: 7 days before", () => {
    expect(describePolicy(snapshot("standard"), TZ, EARLY)[0]).toBe("Free cancellation until Tue 3 Nov 2026, 15:00.");
  });

  test("Non-refundable", () => {
    expect(describePolicy(snapshot("non_refundable"), TZ, EARLY)).toEqual([
      "This rate is non-refundable.",
      EARLY_LINE,
      TAX_LINE,
      NO_SHOW_LINE,
    ]);
  });

  test("once the deadline has passed, it says what a cancellation costs now", () => {
    const late = new Date("2026-11-09T20:00:00Z");
    expect(describePolicy(snapshot("flex"), TZ, late)[0]).toBe("If you cancel now, the room price isn't refunded.");
  });
});

describe("describePolicySteps", () => {
  const steps = (tier: CancellationTier, now: Date) => describePolicySteps(snapshot(tier), TZ, now);

  test("flex before the deadline: free, after that, no-show", () => {
    expect(steps("flex", EARLY)).toEqual([
      {
        kind: "free",
        title: "Free until Mon 9 Nov, 15:00",
        detail: "Cancel before then and you get everything you paid back.",
        until: "2026-11-09T14:00:00.000Z",
        deadlineLabel: "Mon 9 Nov, 15:00",
      },
      {
        kind: "after",
        title: "After that",
        detail: "The room isn't refunded. Tourist tax for nights you don't stay is.",
      },
      { kind: "no_show", title: "If you don't show up", detail: "The hotel keeps the full amount." },
    ]);
  });

  test("flex after the deadline drops the free step", () => {
    const kinds = steps("flex", new Date("2026-11-09T20:00:00Z")).map((s) => s.kind);
    expect(kinds).toEqual(["after", "no_show"]);
  });

  test("non-refundable: non-refundable and no-show", () => {
    expect(steps("non_refundable", EARLY)).toEqual([
      {
        kind: "non_refundable",
        title: "Non-refundable",
        detail: "The room isn't refunded if you cancel. Tourist tax for nights you don't stay is.",
      },
      { kind: "no_show", title: "If you don't show up", detail: "The hotel keeps the full amount." },
    ]);
  });
});
