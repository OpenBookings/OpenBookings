import { describe, expect, test } from "bun:test";
import { ACCOUNT_SECTIONS, activeSection } from "./sections";

describe("account sections", () => {
  test("lists the six tabs in order", () => {
    expect(ACCOUNT_SECTIONS.map((s) => s.title)).toEqual([
      "Bookings",
      "Messages",
      "Personal details",
      "Sign-in & security",
      "Privacy & data",
      "Help & Support",
    ]);
  });

  test("every tab lives under /account/ with a unique href", () => {
    const hrefs = ACCOUNT_SECTIONS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/account/")).toBe(true);
  });

  test("activeSection matches the tab and its subpages, nothing else", () => {
    expect(activeSection("/account/bookings")?.id).toBe("bookings");
    expect(activeSection("/account/messages/123")?.id).toBe("messages");
    expect(activeSection("/account/securityx")).toBeNull();
    expect(activeSection("/account")).toBeNull();
  });
});
