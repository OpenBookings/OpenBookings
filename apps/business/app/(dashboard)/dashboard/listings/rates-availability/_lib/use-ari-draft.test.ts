import { describe, expect, test } from "bun:test";
import { editKey, toChanges, type DraftEdit } from "./use-ari-draft";

/**
 * Folding staged cells into a publish payload.
 *
 * The thing worth pinning is what counts as "the same edit". Group too
 * eagerly and one host's note gets filed under another host's dates; group too
 * timidly and closing a week writes seven rows and reports the decision back
 * as seven separate ones.
 */

const price = (date: string, value: number | null): DraftEdit => ({
  kind: "price",
  ratePlanId: "plan-1",
  date,
  price: value,
});

const closure = (date: string, note: string | null = null): DraftEdit => ({
  kind: "closure",
  ratePlanId: "plan-1",
  date,
  closed: true,
  note,
});

describe("editKey", () => {
  test("one cell holds one edit per kind", () => {
    expect(editKey(price("2026-07-01", 100))).toBe(
      editKey(price("2026-07-01", 250)),
    );
  });

  test("different dates are different edits", () => {
    expect(editKey(price("2026-07-01", 100))).not.toBe(
      editKey(price("2026-07-02", 100)),
    );
  });

  test("a room closure is keyed on the room, not a rate plan", () => {
    expect(
      editKey({
        kind: "roomClosure",
        roomId: "room-1",
        date: "2026-07-01",
        closed: true,
        note: null,
      }),
    ).toBe("roomClosure|room-1|2026-07-01");
  });
});

describe("toChanges", () => {
  test("nothing staged is nothing to publish", () => {
    expect(toChanges([])).toEqual([]);
  });

  test("the same price across days is one change carrying every date", () => {
    const changes = toChanges([
      price("2026-07-01", 120),
      price("2026-07-02", 120),
      price("2026-07-03", 120),
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "price",
      ratePlanId: "plan-1",
      price: 120,
      dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
    });
  });

  test("different prices stay different changes", () => {
    const changes = toChanges([price("2026-07-01", 120), price("2026-07-02", 140)]);
    expect(changes).toHaveLength(2);
  });

  test("clearing a price is its own change, distinct from setting one", () => {
    const changes = toChanges([price("2026-07-01", null), price("2026-07-02", 120)]);
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.type === "price" && c.price === null)).toBeDefined();
  });

  test("dates come back sorted and deduplicated", () => {
    const changes = toChanges([
      price("2026-07-03", 120),
      price("2026-07-01", 120),
      price("2026-07-01", 120),
    ]);
    expect(changes[0].dates).toEqual(["2026-07-01", "2026-07-03"]);
  });

  test("closures with different notes do not merge", () => {
    // Two explanations are two decisions. Merging them would report one
    // host's reason across the other's dates.
    const changes = toChanges([
      closure("2026-07-01", "Rewiring"),
      closure("2026-07-02", "Staff shortage"),
    ]);

    expect(changes).toHaveLength(2);
  });

  test("closures sharing a note merge into one change", () => {
    const changes = toChanges([
      closure("2026-07-01", "Rewiring"),
      closure("2026-07-02", "Rewiring"),
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0].dates).toEqual(["2026-07-01", "2026-07-02"]);
  });

  test("closing and reopening are opposite changes, never one", () => {
    const changes = toChanges([
      closure("2026-07-01"),
      { kind: "closure", ratePlanId: "plan-1", date: "2026-07-02", closed: false, note: null },
    ]);

    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.type === "closure" && c.remove).sort()).toEqual([
      false,
      true,
    ]);
  });

  test("edits on different rate plans never merge", () => {
    const changes = toChanges([
      price("2026-07-01", 120),
      { kind: "price", ratePlanId: "plan-2", date: "2026-07-01", price: 120 },
    ]);
    expect(changes).toHaveLength(2);
  });

  test("a restriction carries all of its fields onto the change", () => {
    const changes = toChanges([
      {
        kind: "restriction",
        ratePlanId: "plan-1",
        date: "2026-07-01",
        minStay: 3,
        maxStay: 10,
        closedToArrival: true,
        closedToDeparture: false,
        note: "Peak week",
        remove: false,
      },
    ]);

    expect(changes[0]).toMatchObject({
      type: "restriction",
      minStay: 3,
      maxStay: 10,
      closedToArrival: true,
      closedToDeparture: false,
      note: "Peak week",
      remove: false,
      dates: ["2026-07-01"],
    });
  });

  test("restrictions differing in only one field stay separate", () => {
    const base: DraftEdit = {
      kind: "restriction",
      ratePlanId: "plan-1",
      date: "2026-07-01",
      minStay: 3,
      maxStay: null,
      closedToArrival: false,
      closedToDeparture: false,
      note: null,
      remove: false,
    };

    const changes = toChanges([
      base,
      { ...base, date: "2026-07-02", minStay: 4 },
    ]);

    expect(changes).toHaveLength(2);
  });
});
