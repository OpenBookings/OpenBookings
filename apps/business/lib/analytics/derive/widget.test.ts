import { describe, expect, test } from "bun:test";
import { unwrapOr, widget } from "./widget";

/**
 * The States table requires that one failing widget must not blank the page.
 * With a single getAnalytics() call there is one failure point, so containment
 * has to happen per derivation rather than per fetch. Today that is defensive;
 * when one aggregate query can fail while its neighbours succeed it is the
 * mechanism that keeps the other four sections on screen.
 */
describe("widget", () => {
  test("carries the computed value", () => {
    expect(widget(() => 42)).toEqual({ ok: true, value: 42 });
  });

  test("contains a throw instead of propagating it", () => {
    const result = widget<number>(() => {
      throw new Error("division by zero in ADR");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("division by zero in ADR");
  });

  test("survives a thrown non-Error", () => {
    const result = widget<number>(() => {
      throw "just a string";
    });
    expect(result).toEqual({ ok: false, message: "Something went wrong." });
  });

  test("a falsy value is still a success", () => {
    expect(widget(() => 0)).toEqual({ ok: true, value: 0 });
    expect(widget(() => null)).toEqual({ ok: true, value: null });
  });
});

describe("unwrapOr", () => {
  test("returns the value when present and the fallback when not", () => {
    expect(unwrapOr(widget(() => 7), 0)).toBe(7);
    expect(
      unwrapOr(
        widget<number>(() => {
          throw new Error("nope");
        }),
        0,
      ),
    ).toBe(0);
  });
});
