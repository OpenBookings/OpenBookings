import { describe, expect, test } from "bun:test";
import { consentEventType } from "./consent-events";

describe("consentEventType", () => {
  test("accepting is granted, whatever came before", () => {
    expect(consentEventType("accepted", null)).toBe("granted");
    expect(consentEventType("accepted", "declined")).toBe("granted");
  });

  test("declining with no prior consent is denied", () => {
    expect(consentEventType("declined", null)).toBe("denied");
    expect(consentEventType("declined", "declined")).toBe("denied");
  });

  test("declining after having accepted is a withdrawal", () => {
    expect(consentEventType("declined", "accepted")).toBe("withdrawn");
  });
});
