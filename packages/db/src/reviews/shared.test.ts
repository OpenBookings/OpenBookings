import { describe, expect, test } from "bun:test";
import { normalizeReviewBody } from "./shared";

describe("normalizeReviewBody", () => {
  test("turns every line ending into \\n, and is idempotent", () => {
    for (const raw of ["a\r\nb", "a\rb", "a\r\r\nb", "a\n\r\nb"]) {
      const once = normalizeReviewBody(raw)!;
      expect(once).not.toContain("\r");
      expect(normalizeReviewBody(once)).toBe(once);
    }
    expect(normalizeReviewBody("a\r\r\nb")).toBe("a\n\nb");
  });

  test("trims, and empty means none", () => {
    expect(normalizeReviewBody("  hi \r\n")).toBe("hi");
    expect(normalizeReviewBody(" \r\n ")).toBeNull();
    expect(normalizeReviewBody(null)).toBeNull();
  });
});
