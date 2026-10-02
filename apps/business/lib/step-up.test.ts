import { describe, expect, test } from "bun:test";
import { isStepUpRequired } from "./step-up";

describe("isStepUpRequired", () => {
  test("recognises the gate's refusal in a Better Auth client result", () => {
    expect(isStepUpRequired({ error: { code: "STEP_UP_REQUIRED", status: 403, message: "…" } })).toBe(true);
  });

  test("any other failure, or success, is not a step-up prompt", () => {
    expect(isStepUpRequired({ error: { code: "FORBIDDEN", status: 403 } })).toBe(false);
    expect(isStepUpRequired({ error: null, data: {} })).toBe(false);
    expect(isStepUpRequired(undefined)).toBe(false);
    expect(isStepUpRequired(null)).toBe(false);
    expect(isStepUpRequired("STEP_UP_REQUIRED")).toBe(false);
  });
});
