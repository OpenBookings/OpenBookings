import { describe, expect, test } from "bun:test";
import { makeRng } from "./rng";

/**
 * Determinism is the whole point. `Math.random()` at render would mismatch
 * between the server pass and hydration, and would hand the host a different
 * revenue figure on every refresh — which is worse than a wrong one, because
 * it is not even wrong twice.
 */
describe("makeRng", () => {
  test("the same seed replays the same sequence", () => {
    const a = makeRng("zeeburg");
    const b = makeRng("zeeburg");
    const draw = (r: ReturnType<typeof makeRng>) =>
      Array.from({ length: 20 }, () => r.next());
    expect(draw(a)).toEqual(draw(b));
  });

  test("different seeds diverge", () => {
    const a = Array.from({ length: 20 }, () => makeRng("zeeburg").next());
    const b = Array.from({ length: 20 }, () => makeRng("vlierhof").next());
    expect(a).not.toEqual(b);
  });

  test("next stays in [0, 1)", () => {
    const rng = makeRng("range");
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("int is inclusive at both ends and never leaves them", () => {
    const rng = makeRng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  test("pick returns a member of the array", () => {
    const rng = makeRng("pick");
    const items = ["NL", "BE", "DE"];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  test("bool(1) is always true and bool(0) always false", () => {
    const rng = makeRng("bool");
    for (let i = 0; i < 50; i++) {
      expect(rng.bool(1)).toBe(true);
      expect(rng.bool(0)).toBe(false);
    }
  });
});
