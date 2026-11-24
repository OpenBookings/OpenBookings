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

  test("never returns negative zero", () => {
    expect(Object.is(roundHalfUp(-0.2), 0)).toBe(true);
    expect(Object.is(roundHalfUp(-0), 0)).toBe(true);
  });
});

describe("percentOfCents", () => {
  test("takes a percentage and rounds half up", () => {
    expect(percentOfCents(9999, -10)).toBe(-1000);
    expect(percentOfCents(10000, 4.5)).toBe(450);
    expect(percentOfCents(1010, 5)).toBe(51);
    expect(Object.is(percentOfCents(1, -10), 0)).toBe(true);
  });

  test("keeps exact half cents for decimal percentages", () => {
    expect(percentOfCents(5500, 0.7)).toBe(39);
    expect(percentOfCents(1500, 2.3)).toBe(35);
    expect(percentOfCents(-5500, 0.7)).toBe(-39);
  });

  test("matches an exact BigInt reference", () => {
    const reference = (cents: number, percent: string): number => {
      const [whole = "0", frac = ""] = percent.split(".");
      const scaled = BigInt(whole + frac);
      const divisor = BigInt(100) * BigInt(10) ** BigInt(frac.length);
      const num = BigInt(cents) * scaled;
      return Number((BigInt(2) * num + divisor) / (BigInt(2) * divisor));
    };
    for (const percent of [0.7, 2.3, 4.5, 6.5, 7.5, 12.34, 21]) {
      for (let cents = 1; cents <= 20000; cents++) {
        const got = percentOfCents(cents, percent);
        const want = reference(cents, String(percent));
        if (got !== want) {
          throw new Error(`percentOfCents(${cents}, ${percent}) = ${got}, want ${want}`);
        }
      }
    }
  });

  test("is not thrown off by float artefacts", () => {
    expect(percentOfCents(1005, 10)).toBe(101);
    expect(percentOfCents(18650, 4.5)).toBe(839);
    expect(percentOfCents(18650, 6.5)).toBe(1212);
    expect(percentOfCents(2010, 4.5)).toBe(90);
    expect(percentOfCents(1000, 4.5)).toBe(45);
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
    expect(formatCents(-6000)).toBe("−€60");
  });

  test("groups thousands with a comma", () => {
    expect(formatCents(123400)).toBe("€1,234");
    expect(formatCents(123450)).toBe("€1,234.50");
    expect(formatCents(123400, { whole: "always-decimals" })).toBe("€1,234.00");
    expect(formatCents(-123450)).toBe("−€1,234.50");
    expect(formatCents(100000000)).toBe("€1,000,000");
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
