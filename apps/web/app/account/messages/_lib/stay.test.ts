import { describe, expect, test } from "bun:test";
import { nightsBetween, runPosition, stayRange, stayStatus } from "./stay";

describe("stayStatus", () => {
  const status = (today: string) => stayStatus("2026-11-13", "2026-11-15", today);

  test("counts down to check-in", () => {
    expect(status("2026-11-01")).toEqual({ phase: "upcoming", label: "In 12 days" });
    expect(status("2026-11-12")).toEqual({ phase: "upcoming", label: "Tomorrow" });
  });

  test("is current from check-in day through check-out day", () => {
    expect(status("2026-11-13")).toEqual({ phase: "current", label: "Check-in today" });
    expect(status("2026-11-14")).toEqual({ phase: "current", label: "Staying now" });
    expect(status("2026-11-15")).toEqual({ phase: "current", label: "Check-out today" });
  });

  test("is past after check-out day", () => {
    expect(status("2026-11-16")).toEqual({ phase: "past", label: "Past stay" });
  });

  test("handles a month boundary", () => {
    expect(stayStatus("2026-12-04", "2026-12-06", "2026-11-01")?.label).toBe("In 33 days");
  });

  test("is null without a booking", () => {
    expect(stayStatus(null, null, "2026-11-01")).toBeNull();
  });
});

test("nightsBetween", () => {
  expect(nightsBetween("2026-11-13", "2026-11-15")).toBe(2);
  expect(nightsBetween("2026-11-28", "2026-12-02")).toBe(4);
});

test("stayRange", () => {
  expect(stayRange("2026-11-13", "2026-11-15")).toBe("13–15 Nov");
  expect(stayRange("2026-11-28", "2026-12-02")).toBe("28 Nov – 2 Dec");
  expect(stayRange(null, "2026-12-02")).toBeNull();
});

describe("runPosition", () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const msgs = [
    { sender_role: "guest", created_at: "2026-10-31T18:20:00Z" },
    { sender_role: "guest", created_at: "2026-10-31T18:21:00Z" },
    { sender_role: "host", created_at: "2026-10-31T18:22:00Z" },
    { sender_role: "host", created_at: "2026-10-31T18:40:00Z" },
    { sender_role: "host", created_at: "2026-10-31T18:41:00Z" },
    { sender_role: "host", created_at: "2026-11-01T00:01:00Z" },
  ];
  const at = (i: number) => runPosition(msgs, i, dayOf);

  test("joins close messages from the same side", () => {
    expect(at(0)).toEqual({ first: true, last: false });
    expect(at(1)).toEqual({ first: false, last: true });
  });

  test("breaks on a long gap", () => {
    expect(at(2)).toEqual({ first: true, last: true });
    expect(at(3)).toEqual({ first: true, last: false });
  });

  test("breaks on a new day", () => {
    expect(at(4)).toEqual({ first: false, last: true });
    expect(at(5)).toEqual({ first: true, last: true });
  });
});
