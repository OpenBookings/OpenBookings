import { describe, expect, it } from "bun:test";
import { removalOf } from "./moderation";

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
