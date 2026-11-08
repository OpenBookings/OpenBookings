import { describe, expect, test } from "bun:test";
import { commissionSplit } from "./commission";

describe("commissionSplit", () => {
  test("splits a VAT-inclusive Dutch fee into net and 21% VAT", () => {
    expect(commissionSplit({ feeCents: 1080, treatment: "NL_DOMESTIC" })).toEqual({ netCents: 893, vatCents: 187 });
  });

  test("reverse charge keeps the whole fee as net", () => {
    expect(commissionSplit({ feeCents: 1080, treatment: "EU_REVERSE_CHARGE" })).toEqual({ netCents: 1080, vatCents: 0 });
  });

  test("no fee, no split", () => {
    expect(commissionSplit({ feeCents: 0, treatment: "NL_DOMESTIC" })).toEqual({ netCents: 0, vatCents: 0 });
  });

  test("refuses a fee that is not a non-negative whole number of cents", () => {
    for (const feeCents of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => commissionSplit({ feeCents, treatment: "NL_DOMESTIC" })).toThrow();
    }
  });
});
