import { describe, expect, test } from "bun:test";
import { buildMockAriGrid } from "./mock-ari";
import { buildRuns } from "./runs";
import type { CellState, RatePlanStatus } from "./types";

/**
 * The demo dataset exists to show the screen working. These pin down that it
 * actually does — a spec edit that quietly stops producing sold-out cells, or
 * flattens every bar to one column, should fail here rather than in a demo.
 */

const grid = buildMockAriGrid("2026-08-01", 14, 1);
const allCells = grid.rooms.flatMap((r) => r.ratePlans.flatMap((p) => p.cells));

describe("buildMockAriGrid", () => {
  test("fills the requested window", () => {
    expect(grid.dates).toHaveLength(14);
    expect(grid.dates[0]).toBe("2026-08-01");
    expect(grid.dates.at(-1)).toBe("2026-08-14");
  });

  test("has enough rooms and plans to need collapsing", () => {
    expect(grid.rooms.length).toBeGreaterThanOrEqual(6);
    const plans = grid.rooms.reduce((n, r) => n + r.ratePlans.length, 0);
    expect(plans).toBeGreaterThanOrEqual(15);
  });

  test("exercises all four cell states", () => {
    const states = new Set<CellState>(allCells.map((c) => c.state));
    expect([...states].sort()).toEqual([
      "closed",
      "open",
      "restricted",
      "sold_out",
    ]);
  });

  test("exercises all three status-dot values", () => {
    const statuses = new Set<RatePlanStatus>(
      grid.rooms.flatMap((r) => r.ratePlans.map((p) => p.status)),
    );
    expect([...statuses].sort()).toEqual(["attention", "healthy", "inactive"]);
  });

  test("produces multi-day bars, not just single cells", () => {
    const spanning = grid.rooms
      .flatMap((r) => r.ratePlans)
      .flatMap((p) => buildRuns(p.cells))
      .filter((run) => run.state !== "open" && run.endIndex - run.startIndex > 1);
    expect(spanning.length).toBeGreaterThan(5);
  });

  test("sold out cascades across every plan on the room type", () => {
    for (const room of grid.rooms) {
      const soldOutDates = room.availability
        .filter((a) => a.effective <= 0)
        .map((a) => a.date);
      for (const date of soldOutDates) {
        for (const plan of room.ratePlans) {
          const cell = plan.cells.find((c) => c.date === date);
          expect(cell?.state).toBe("sold_out");
        }
      }
    }
  });

  test("shows both availability layers", () => {
    const sources = new Set(
      grid.rooms.flatMap((r) => r.availability.map((a) => a.source)),
    );
    expect(sources).toContain("computed");
    expect(sources).toContain("override");
  });

  test("unsellable cells carry no price, sellable ones do", () => {
    for (const cell of allCells) {
      if (cell.state === "closed" || cell.state === "sold_out") {
        expect(cell.price).toBeNull();
      } else {
        expect(cell.price).toBeGreaterThan(0);
      }
    }
  });

  test("the collapsed row is the cheapest sellable rate, or null", () => {
    for (const room of grid.rooms) {
      room.lowestRates.forEach((lowest, index) => {
        const date = grid.dates[index];
        const prices = room.ratePlans
          .map((p) => p.cells.find((c) => c.date === date)?.price)
          .filter((p): p is number => p != null);
        expect(lowest).toBe(prices.length === 0 ? null : Math.min(...prices));
      });
    }
  });

  test("stay-length discounts are marked pending at one night and fire at seven", () => {
    const oneNight = buildMockAriGrid("2026-08-01", 14, 1);
    const weekStay = buildMockAriGrid("2026-08-01", 14, 7);

    const pendingAtOne = oneNight.rooms
      .flatMap((r) => r.ratePlans)
      .filter((p) => p.hasStayDiscount)
      .flatMap((p) => p.cells)
      .some((c) => c.stayDiscountPending);
    expect(pendingAtOne).toBe(true);

    const firedAtSeven = weekStay.rooms
      .flatMap((r) => r.ratePlans)
      .flatMap((p) => p.cells)
      .some((c) => c.appliedModifiers.includes("length_of_stay"));
    expect(firedAtSeven).toBe(true);
  });

  test("a restriction that only restates the plan default is not 'restricted'", () => {
    // Twin Rooms' Corporate plan has min stay 2 by default; the demo's rule
    // raises it to 3 so the bar means something.
    const corporate = grid.rooms
      .find((r) => r.name === "Twin Rooms")
      ?.ratePlans.find((p) => p.name === "Corporate");
    expect(corporate).toBeDefined();
    const restricted = corporate!.cells.filter((c) => c.state === "restricted");
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every((c) => c.minStay > corporate!.minStay)).toBe(true);
  });
});
