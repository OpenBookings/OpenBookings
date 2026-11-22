import { describe, expect, it } from "bun:test";
import { safeReturnTo, sectionIndex } from "./section-index";

describe("sectionIndex", () => {
  it.each([
    ["/dashboard/bookings/reservations/abc", "/dashboard/bookings/reservations"],
    ["/dashboard", "/dashboard"],
    ["/dashboard/team", "/dashboard/team"],
    ["/dashboard/finance/billing", "/dashboard/finance/billing"],
    ["/dashboard/", "/dashboard"],
    ["/elsewhere/a/b", "/dashboard"],
  ])("%s -> %s", (input, expected) => {
    expect(sectionIndex(input)).toBe(expected);
  });
});

describe("safeReturnTo", () => {
  it.each([
    ["/dashboard/team", "/dashboard/team"],
    ["/dashboard/rooms/x?tab=1", "/dashboard/rooms/x"],
    ["https://evil.example/dashboard", "/dashboard"],
    ["//evil.example/dashboard", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/dashboardx", "/dashboard"],
    ["/login", "/dashboard"],
    ["", "/dashboard"],
  ])("%s -> %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
