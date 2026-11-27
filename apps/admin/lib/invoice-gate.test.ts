import { describe, expect, test } from "bun:test";
import { productionRunRefusal } from "./invoice-gate";

const real = ["--step=deliver", "--period=2026-10"];
const dry = ["--step=draft", "--period=2026-10", "--dry-run"];

describe("productionRunRefusal", () => {
  test("the direct path takes dry runs only", () => {
    expect(productionRunRefusal(dry, "dry")).toBeNull();
    expect(productionRunRefusal(real, "dry")).toContain("confirm it with a reason");
  });

  test("the confirmed path takes real runs only", () => {
    expect(productionRunRefusal(real, "confirmed")).toBeNull();
    expect(productionRunRefusal(dry, "confirmed")).toContain("needs no confirmation");
  });

  test("test-only flags are refused on both paths, before any step-up", () => {
    for (const flag of ["--open-month", "--ignore-unknown-accounts"]) {
      expect(productionRunRefusal([...real, flag], "confirmed")).toContain("test-only");
      expect(productionRunRefusal([...dry, flag], "dry")).toContain("test-only");
    }
  });
});
