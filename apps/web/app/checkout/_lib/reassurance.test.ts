import { describe, expect, test } from "bun:test";
import type { PolicyStep } from "@openbookings/pricing";
import { holdLabel, payAtPropertyLine, payReassurance } from "./reassurance";

const MIN = 60_000;
const format = () => "14:30";

describe("holdLabel", () => {
  test("10 minutes left: the clock time, not urgent", () => {
    expect(holdLabel(10 * MIN, 0, format)).toEqual({ text: "Room held until 14:30", urgent: false });
  });
  test("exactly 120 s left is already urgent", () => {
    expect(holdLabel(120_000, 0, format)).toEqual({ text: "2 min left", urgent: true });
  });
  test("119 s left: 2 min, urgent", () => {
    expect(holdLabel(119_000, 0, format)).toEqual({ text: "2 min left", urgent: true });
  });
  test("0 s left: at least 1 min", () => {
    expect(holdLabel(0, 0, format)).toEqual({ text: "1 min left", urgent: true });
  });
});

const free = (until: string, deadlineLabel: string): PolicyStep => ({
  kind: "free",
  title: `Free until ${deadlineLabel}`,
  detail: "",
  until,
  deadlineLabel,
});
const after: PolicyStep = { kind: "after", title: "After that", detail: "" };
const nonRefundable: PolicyStep = { kind: "non_refundable", title: "Non-refundable", detail: "" };

describe("payReassurance", () => {
  test("all free: the earliest deadline", () => {
    expect(
      payReassurance([
        [free("2026-12-10T13:00:00.000Z", "Thu 10 Dec, 14:00"), after],
        [free("2026-12-08T13:00:00.000Z", "Tue 8 Dec, 14:00"), after],
      ]),
    ).toEqual({ tone: "free", text: "Free cancellation until Tue 8 Dec, 14:00" });
  });
  test("all non-refundable", () => {
    expect(payReassurance([[nonRefundable], [nonRefundable]])).toEqual({
      tone: "neutral",
      text: "Non-refundable · you confirmed this above",
    });
  });
  test("mixed", () => {
    expect(payReassurance([[free("2026-12-10T13:00:00.000Z", "Thu 10 Dec, 14:00"), after], [nonRefundable]])).toEqual({
      tone: "neutral",
      text: "Cancellation terms differ per room. See the summary.",
    });
  });
});

describe("payAtPropertyLine", () => {
  const room = (payAtProperty: number, cots: number, extraBeds: number) => ({ payAtProperty, cots, extraBeds });
  test("nothing paid there", () => {
    expect(payAtPropertyLine([room(0, 0, 0)])).toBeNull();
  });
  test("one extra bed", () => {
    expect(payAtPropertyLine([room(75, 0, 1)])).toBe("+ €75.00 at the property for the extra bed");
  });
  test("sums across rooms, plural", () => {
    expect(payAtPropertyLine([room(75, 0, 1), room(60, 0, 1)])).toBe("+ €135.00 at the property for the extra beds");
  });
  test("cot and extra bed", () => {
    expect(payAtPropertyLine([room(90, 1, 1)])).toBe("+ €90.00 at the property for the cot and extra bed");
  });
});
