import { describe, expect, test } from "bun:test";
import { invoiceNumber, seriesFor } from "./issue";

describe("invoice numbers", () => {
  test("the series is the issue date's year", () => {
    expect(seriesFor("2026-12-31")).toBe("OB-2026");
    expect(seriesFor("2027-01-01")).toBe("OB-2027");
    expect(() => seriesFor("2026-1-5")).toThrow(RangeError);
  });

  test("numbers are padded to four digits and grow past 9999", () => {
    expect(invoiceNumber("OB-2026", 1)).toBe("OB-2026-0001");
    expect(invoiceNumber("OB-2026", 9999)).toBe("OB-2026-9999");
    expect(invoiceNumber("OB-2026", 10000)).toBe("OB-2026-10000");
  });
});
