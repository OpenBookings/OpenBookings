import { describe, expect, test } from "bun:test";
import { areaKey, seededRng } from "./random";

describe("seededRng", () => {
  test("same seed gives the same sequence, different seeds differ", () => {
    const a1 = seededRng("a");
    const a2 = seededRng("a");
    expect([a1.next(), a1.next(), a1.next()]).toEqual([a2.next(), a2.next(), a2.next()]);
    expect(seededRng("a").next()).not.toBe(seededRng("b").next());
  });

  test("next is in [0, 1)", () => {
    const r = seededRng("range");
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int is inclusive of both ends and stays in range", () => {
    const r = seededRng("int");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  test("pick returns an element of the list", () => {
    const r = seededRng("pick");
    const xs = ["x", "y", "z"] as const;
    for (let i = 0; i < 50; i++) expect(xs).toContain(r.pick(xs));
  });
});

describe("areaKey", () => {
  test("rounds to one decimal each", () => {
    expect(areaKey(52.3676, 4.9041)).toBe("52.4:4.9");
  });
});
