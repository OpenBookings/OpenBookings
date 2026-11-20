import { describe, expect, test } from "bun:test";
import type { BookingAction } from "@openbookings/pricing";
import { ACTION_PERMISSION, actionsForViewer, viewerCanRetryRefunds } from "./permissions";

const ALL: BookingAction[] = ["cancel", "mark_checked_in", "mark_no_show", "record_early_departure", "goodwill_refund"];

describe("actionsForViewer", () => {
  test("owner and general manager get every action, a goodwill request included", () => {
    expect(actionsForViewer(ALL, { role: "owner", hasPropertyAccess: false })).toEqual(ALL);
    expect(actionsForViewer(ALL, { role: "admin", hasPropertyAccess: false })).toEqual(ALL);
  });

  test("a manager can cancel and request goodwill refunds", () => {
    expect(actionsForViewer(ALL, { role: "manager", hasPropertyAccess: true })).toEqual([
      "cancel",
      "mark_checked_in",
      "mark_no_show",
      "record_early_departure",
      "goodwill_refund",
    ]);
  });

  test("front desk works the stay but cannot cancel or refund", () => {
    expect(actionsForViewer(ALL, { role: "frontdesk", hasPropertyAccess: true })).toEqual([
      "mark_checked_in",
      "mark_no_show",
      "record_early_departure",
    ]);
  });

  test("back office only looks", () => {
    expect(actionsForViewer(ALL, { role: "finance", hasPropertyAccess: false })).toEqual([]);
    expect(viewerCanRetryRefunds({ role: "finance", hasPropertyAccess: false })).toBe(false);
  });

  test("a scoped role without its property row gets nothing", () => {
    expect(actionsForViewer(ALL, { role: "reservations", hasPropertyAccess: false })).toEqual([]);
  });

  test("never adds an action the booking's state did not allow", () => {
    expect(actionsForViewer(["cancel"], { role: "owner", hasPropertyAccess: true })).toEqual(["cancel"]);
  });
});

describe("goodwill refunds", () => {
  test("a host can only ask for one: the grant is request-refund, never a refund", () => {
    expect(ACTION_PERMISSION.goodwill_refund).toEqual({ booking: ["request-refund"] });
  });
});
