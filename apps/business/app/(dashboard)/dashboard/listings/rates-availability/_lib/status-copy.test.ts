import { describe, expect, test } from "bun:test";
import { isAppRule } from "./status-copy";

describe("isAppRule", () => {
  test("rules SiteMinder sent carry app: ids; a team member's and derived ones do not", () => {
    expect(isAppRule({ ruleId: "app:plan-1:closed" })).toBe(true);
    expect(isAppRule({ ruleId: "app:plan-1:restriction" })).toBe(true);
    expect(isAppRule({ ruleId: "5f0c2a1e-0000-4000-8000-000000000000" })).toBe(false);
    expect(isAppRule({ ruleId: null })).toBe(false);
  });
});
