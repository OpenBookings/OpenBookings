import { describe, expect, test } from "bun:test";
import { buildRuns, restrictionLabel } from "./runs";
import type { CellState, RateCell, RestrictionRule } from "./types";

const rule = (id: string, overrides: Partial<RestrictionRule> = {}): RestrictionRule => ({
  id,
  startDate: "2026-07-01",
  endDate: "2026-07-05",
  isClosed: false,
  minStay: null,
  maxStay: null,
  closedToArrival: false,
  closedToDeparture: false,
  note: null,
  createdBy: null,
  createdByName: null,
  createdAt: "2026-06-01T00:00:00Z",
  ...overrides,
});

const cell = (
  date: string,
  state: CellState,
  ruleValue: RestrictionRule | null = null,
): RateCell => ({
  date,
  state,
  price: state === "open" ? 100 : null,
  basePrice: 100,
  hasOverride: false,
  overrideLabel: null,
  appliedModifiers: [],
  stayDiscountPending: false,
  minStay: 1,
  maxStay: null,
  closedToArrival: false,
  closedToDeparture: false,
  rule: ruleValue,
  available: 3,
});

describe("buildRuns", () => {
  test("open cells stay one per column so each keeps its price", () => {
    const runs = buildRuns([
      cell("2026-07-01", "open"),
      cell("2026-07-02", "open"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.endIndex - r.startIndex === 1)).toBe(true);
  });

  test("consecutive cells under the same rule merge into one bar", () => {
    const closure = rule("closure-1", { isClosed: true });
    const runs = buildRuns([
      cell("2026-07-01", "open"),
      cell("2026-07-02", "closed", closure),
      cell("2026-07-03", "closed", closure),
      cell("2026-07-04", "closed", closure),
      cell("2026-07-05", "open"),
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[1]).toMatchObject({ state: "closed", startIndex: 1, endIndex: 4 });
  });

  test("adjacent closures from different rules stay separate bars", () => {
    // Two decisions the host made on two occasions. Merging them would report
    // one wrong date range in the detail panel.
    const runs = buildRuns([
      cell("2026-07-01", "closed", rule("closure-1", { isClosed: true })),
      cell("2026-07-02", "closed", rule("closure-2", { isClosed: true })),
    ]);
    expect(runs).toHaveLength(2);
  });

  test("different states never merge", () => {
    const runs = buildRuns([
      cell("2026-07-01", "sold_out"),
      cell("2026-07-02", "closed"),
    ]);
    expect(runs.map((r) => r.state)).toEqual(["sold_out", "closed"]);
  });

  test("a run reaching the end of the range is closed off", () => {
    const closure = rule("closure-1", { isClosed: true });
    const runs = buildRuns([
      cell("2026-07-01", "open"),
      cell("2026-07-02", "closed", closure),
      cell("2026-07-03", "closed", closure),
    ]);
    expect(runs[1].endIndex).toBe(3);
    expect(runs[1].cells).toHaveLength(2);
  });
});

describe("restrictionLabel", () => {
  test("min stay reads as nights", () => {
    const c = cell("2026-07-01", "restricted", rule("r", { minStay: 3 }));
    expect(restrictionLabel(c)).toBe("Min 3 nt");
  });

  test("combined rules are joined", () => {
    const c = {
      ...cell("2026-07-01", "restricted", rule("r", { minStay: 2 })),
      closedToArrival: true,
    };
    expect(restrictionLabel(c)).toBe("Min 2 nt · No arrival");
  });

  test("falls back rather than rendering an empty bar", () => {
    expect(restrictionLabel(cell("2026-07-01", "restricted"))).toBe("Restricted");
  });
});
