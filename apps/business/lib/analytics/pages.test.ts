import { describe, expect, test } from "bun:test";
import { carryQuery, PAGE_IDS, PAGES } from "./pages";

describe("pages", () => {
  test("five pages, in nav order", () => {
    expect([...PAGE_IDS]).toEqual(["revenue", "occupancy", "booking-patterns", "pricing", "guests"]);
  });

  test("each path is the id under the analytics root", () => {
    for (const id of PAGE_IDS) expect(PAGES[id].path).toBe(`/dashboard/analytics/${id}`);
  });
});

describe("carryQuery", () => {
  test("keeps the period, comparison and demo params and drops everything else", () => {
    const search = new URLSearchParams("period=custom&from=2026-01-01&to=2026-02-01&compare=none&demo=1&property=x&fail=y");
    expect(carryQuery(search)).toBe("?period=custom&from=2026-01-01&to=2026-02-01&compare=none&demo=1");
  });

  test("is empty when there is nothing to carry", () => {
    expect(carryQuery(new URLSearchParams("utm=1"))).toBe("");
  });
});
