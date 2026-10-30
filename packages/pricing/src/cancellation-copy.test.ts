import { describe, expect, test } from "bun:test";
import { buildPolicySnapshot, type CancellationTier } from "./cancellation";
import { describePolicy, formatDeadline, TIER_LABELS, TIER_SUMMARIES } from "./cancellation-copy";

const DAY = 86_400_000;
const TZ = "Europe/Amsterdam";
const snapshot = (tier: CancellationTier) =>
  buildPolicySnapshot({
    tier,
    timeZone: TZ,
    checkInTime: "15:00",
    arrivalDate: "2026-11-10",
    confirmedAt: new Date("2026-10-01T10:00:00Z"),
  });
/** Well after the grace period, well before any deadline. */
const EARLY = new Date("2026-10-05T10:00:00Z");

const TAX_LINE = "Tourist tax is refunded for nights you don't stay.";
const NO_SHOW_LINE = "If you don't show up, nothing is refunded.";

describe("labels", () => {
  test("the four tier names", () => {
    expect(TIER_LABELS).toEqual({
      flex: "Flex",
      standard: "Standard",
      limited: "Limited",
      non_refundable: "Non-refundable",
    });
  });

  test("every tier has a one-line summary", () => {
    expect(TIER_SUMMARIES.flex).toBe(
      "Free cancellation until 24 hours before check-in. After that, the first night is charged.",
    );
    expect(Object.keys(TIER_SUMMARIES).sort()).toEqual(["flex", "limited", "non_refundable", "standard"]);
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
  test("Flex: the deadline, what happens after, tourist tax and no-shows", () => {
    expect(describePolicy(snapshot("flex"), TZ, EARLY)).toEqual([
      "Free cancellation until Mon 9 Nov 2026, 15:00.",
      "After that, the first night is charged and the other nights are refunded.",
      TAX_LINE,
      NO_SHOW_LINE,
    ]);
  });

  test("Limited adds the 50% deadline", () => {
    expect(describePolicy(snapshot("limited"), TZ, EARLY)).toEqual([
      "Free cancellation until Tue 27 Oct 2026, 15:00.",
      "50% refund if you cancel by Tue 3 Nov 2026, 15:00.",
      "After that, no refund.",
      TAX_LINE,
      NO_SHOW_LINE,
    ]);
  });

  test("Non-refundable", () => {
    expect(describePolicy(snapshot("non_refundable"), TZ, EARLY)).toEqual([
      "This rate is non-refundable.",
      TAX_LINE,
      NO_SHOW_LINE,
    ]);
  });

  test("deadlines already passed are left out", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(describePolicy(snapshot("limited"), TZ, now)[0]).toBe("50% refund if you cancel by Tue 3 Nov 2026, 15:00.");
  });

  test("the grace period is mentioned only when it outlasts the free window", () => {
    const confirmed = new Date(Date.parse("2026-11-10T14:00:00Z") - 10 * DAY);
    const s = buildPolicySnapshot({ tier: "limited", timeZone: TZ, checkInTime: "15:00", arrivalDate: "2026-11-10", confirmedAt: confirmed });
    expect(describePolicy(s, TZ, confirmed)[0]).toBe("Full refund if you cancel by Sun 1 Nov 2026, 15:00.");
    expect(describePolicy(snapshot("flex"), TZ, new Date("2026-10-01T11:00:00Z"))[0]).toBe(
      "Free cancellation until Mon 9 Nov 2026, 15:00.",
    );
  });

  test("once every deadline has passed, it says what a cancellation costs now", () => {
    const late = new Date("2026-11-09T20:00:00Z");
    expect(describePolicy(snapshot("flex"), TZ, late)[0]).toBe(
      "If you cancel, the first night is charged and the other nights are refunded.",
    );
    expect(describePolicy(snapshot("standard"), TZ, late)[0]).toBe(
      "If you cancel, the first night and half of the other nights are charged.",
    );
    expect(describePolicy(snapshot("limited"), TZ, late)[0]).toBe("If you cancel, there is no refund.");
  });
});
