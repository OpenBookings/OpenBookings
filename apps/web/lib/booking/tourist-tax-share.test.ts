import { describe, expect, test } from "bun:test";
import { touristTaxShare } from "./tourist-tax-share";

describe("touristTaxShare", () => {
  test("a normal tourist tax is fine", () => {
    expect(touristTaxShare(200, 25)).toBe("ok");
    expect(touristTaxShare(200, 100)).toBe("ok");
    expect(touristTaxShare(200, 0)).toBe("ok");
  });

  test("more than half the room price is flagged for staff", () => {
    expect(touristTaxShare(200, 100.01)).toBe("flag");
    expect(touristTaxShare(200, 200)).toBe("flag");
  });

  test("more tax than room price is refused", () => {
    expect(touristTaxShare(1, 30)).toBe("refuse");
    expect(touristTaxShare(200, 200.01)).toBe("refuse");
  });

  test("tax on a free room is refused", () => {
    expect(touristTaxShare(0, 5)).toBe("refuse");
    expect(touristTaxShare(0, 0)).toBe("ok");
  });
});
