import { describe, expect, it } from "bun:test";
import { isReopened, removalOf } from "./moderation";

describe("removalOf", () => {
  it("keeps the known rules once each, and a trimmed note of at most 1,000 characters", () => {
    expect(removalOf(["abuse", "not_a_rule", "abuse", 7, "threat"], `  ${"x".repeat(1200)}  `)).toEqual({
      rules: ["abuse", "threat"],
      note: "x".repeat(1000),
    });
  });

  it("an empty note is no note, and anything else isn't a list of rules", () => {
    expect(removalOf("abuse", "   ")).toEqual({ rules: [], note: null });
    expect(removalOf(undefined, 42)).toEqual({ rules: [], note: null });
  });
});

describe("isReopened", () => {
  const open = [{ status: "open" as const }];
  const closed = [{ status: "dismissed" as const }];

  it("a kept, published item with an open report can be decided once more", () => {
    expect(isReopened({ decision: "kept", status: "published" }, open)).toBe(true);
  });

  it("not without an open report, and never a removed item, or one nobody decided", () => {
    expect(isReopened({ decision: "kept", status: "published" }, closed)).toBe(false);
    expect(isReopened({ decision: "removed", status: "removed" }, open)).toBe(false);
    expect(isReopened({ decision: null, status: "published" }, open)).toBe(false);
    expect(isReopened({ decision: null, status: "pending" }, open)).toBe(false);
  });
});
