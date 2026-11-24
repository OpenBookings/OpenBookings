import { describe, expect, test } from "bun:test";
import {
  centsToInput,
  formatCents,
  parseEuroInput,
  percentOfCents,
  roundHalfUp,
} from "./money";

describe("roundHalfUp", () => {
  test("rounds half away from zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(-2.4999)).toBe(-2);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe("percentOfCents", () => {
  test("takes a percentage and rounds half up", () => {
    expect(percentOfCents(9999, -10)).toBe(-1000);
    expect(percentOfCents(10000, 4.5)).toBe(450);
    expect(percentOfCents(1010, 5)).toBe(51);
  });
});

describe("parseEuroInput", () => {
  test("accepts whole and decimal amounts with . or ,", () => {
    expect(parseEuroInput("89")).toEqual({ ok: true, cents: 8900 });
    expect(parseEuroInput("89.5")).toEqual({ ok: true, cents: 8950 });
    expect(parseEuroInput("89,50")).toEqual({ ok: true, cents: 8950 });
    expect(parseEuroInput(" 89.50 ")).toEqual({ ok: true, cents: 8950 });
    expect(parseEuroInput("0")).toEqual({ ok: true, cents: 0 });
    expect(parseEuroInput("0.29")).toEqual({ ok: true, cents: 29 });
    expect(parseEuroInput("1.15")).toEqual({ ok: true, cents: 115 });
  });

  test("rejects more than two decimals", () => {
    expect(parseEuroInput("89.505")).toEqual({
      ok: false,
      error: "Use at most two decimals",
    });
  });

  test("rejects thousands separators", () => {
    const r = parseEuroInput("1.234,50");
    expect(r.ok).toBe(false);
  });

  test("rejects negatives", () => {
    expect(parseEuroInput("-5")).toEqual({
      ok: false,
      error: "Enter an amount of 0 or more",
    });
  });

  test("rejects empty and non-numeric input", () => {
    const hint = "Enter an amount like 89 or 89.50";
    expect(parseEuroInput("")).toEqual({ ok: false, error: hint });
    expect(parseEuroInput("   ")).toEqual({ ok: false, error: hint });
    expect(parseEuroInput("abc")).toEqual({ ok: false, error: hint });
  });
});

describe("formatCents", () => {
  test("auto drops decimals for whole euros only", () => {
    expect(formatCents(8900)).toBe("€89");
    expect(formatCents(8950)).toBe("€89.50");
    expect(formatCents(0)).toBe("€0");
  });

  test("always-decimals shows two decimals", () => {
    expect(formatCents(8900, { whole: "always-decimals" })).toBe("€89.00");
    expect(formatCents(8950, { whole: "always-decimals" })).toBe("€89.50");
  });

  test("negative amounts get a real minus sign", () => {
    expect(formatCents(-6000, { whole: "always-decimals" })).toBe("−€60.00");
    expect(formatCents(-6050)).toBe("−€60.50");
  });
});

describe("centsToInput", () => {
  test("renders whole euros without decimals", () => {
    expect(centsToInput(8950)).toBe("89.50");
    expect(centsToInput(8900)).toBe("89");
    expect(centsToInput(5)).toBe("0.05");
  });

  test("round-trips with parseEuroInput", () => {
    for (const cents of [0, 5, 100, 8900, 8950, 12345]) {
      expect(parseEuroInput(centsToInput(cents))).toEqual({ ok: true, cents });
    }
  });
});
