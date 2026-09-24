import { describe, expect, test } from "bun:test";
import { buildRuns, groupConsecutiveDates } from "./runs";
import type { CellState, RateCell, ReasonCode, RestrictionRule } from "./types";

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

/** The reason code each state is painted by, for fixtures that only name a state. */
const PRIMARY_BY_STATE: Record<CellState, ReasonCode | null> = {
  open: null,
  room_closed: "ROOM_CLOSED",
  closed: "STOP_SELL",
  sold_out: "SOLD_OUT",
  restricted: "MIN_STAY",
};

const cell = (
  date: string,
  state: CellState,
  ruleValue: RestrictionRule | null = null,
): RateCell => {
  const primary = PRIMARY_BY_STATE[state];
  return {
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
    primary,
    reasons: primary
      ? [
          {
            code: primary,
            source: ruleValue
              ? {
                  kind: "host",
                  userId: ruleValue.createdBy,
                  userName: ruleValue.createdByName,
                  at: ruleValue.createdAt,
                  note: ruleValue.note,
                }
              : { kind: "system" },
            inherited: false,
            range: ruleValue
              ? { start: ruleValue.startDate, end: ruleValue.endDate }
              : null,
            ruleId: ruleValue?.id ?? null,
          },
        ]
      : [],
    bookable: state === "open" || state === "restricted",
    indicativePrice: 100,
    trace: [],
  };
};

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

  test("consecutive sold-out dates are one bar, having one fact to report", () => {
    const runs = buildRuns([
      cell("2026-07-01", "sold_out"),
      cell("2026-07-02", "sold_out"),
      cell("2026-07-03", "sold_out"),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ startIndex: 0, endIndex: 3 });
  });

  test("adjacent room closures from different rules stay separate bars", () => {
    const runs = buildRuns([
      cell("2026-07-01", "room_closed", rule("room-closure-1")),
      cell("2026-07-02", "room_closed", rule("room-closure-2")),
    ]);
    expect(runs).toHaveLength(2);
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

describe("groupConsecutiveDates", () => {
  test("a single date is one one-day range", () => {
    expect(groupConsecutiveDates(["2026-07-04"])).toEqual([
      { start: "2026-07-04", end: "2026-07-04" },
    ]);
  });

  test("consecutive dates collapse into one range", () => {
    expect(
      groupConsecutiveDates(["2026-07-01", "2026-07-02", "2026-07-03"]),
    ).toEqual([{ start: "2026-07-01", end: "2026-07-03" }]);
  });

  test("a gap starts a new range", () => {
    expect(
      groupConsecutiveDates([
        "2026-07-01",
        "2026-07-02",
        "2026-07-05",
        "2026-07-06",
      ]),
    ).toEqual([
      { start: "2026-07-01", end: "2026-07-02" },
      { start: "2026-07-05", end: "2026-07-06" },
    ]);
  });

  test("order and duplicates do not matter", () => {
    expect(
      groupConsecutiveDates([
        "2026-07-03",
        "2026-07-01",
        "2026-07-02",
        "2026-07-01",
      ]),
    ).toEqual([{ start: "2026-07-01", end: "2026-07-03" }]);
  });

  test("it steps across a month boundary", () => {
    expect(
      groupConsecutiveDates(["2026-07-30", "2026-07-31", "2026-08-01"]),
    ).toEqual([{ start: "2026-07-30", end: "2026-08-01" }]);
  });

  test("it steps across a DST change without skipping a day", () => {
    // Europe/Amsterdam springs forward on 2026-03-29. Stepping in local time
    // would land on the 29th twice, or skip it.
    expect(
      groupConsecutiveDates(["2026-03-28", "2026-03-29", "2026-03-30"]),
    ).toEqual([{ start: "2026-03-28", end: "2026-03-30" }]);
  });

  test("nothing in, nothing out", () => {
    expect(groupConsecutiveDates([])).toEqual([]);
  });
});
