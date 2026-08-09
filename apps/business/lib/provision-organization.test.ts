import { describe, expect, test } from "bun:test";
import { RESERVED_ORG_SLUGS, slugifyOrgName } from "./provision-organization";

describe("slugifyOrgName", () => {
  test("slugifies legal names", () => {
    expect(slugifyOrgName("Hotel De Zon B.V.")).toBe("hotel-de-zon-b-v");
    expect(slugifyOrgName("  Café Ørsted  ")).toBe("cafe-rsted");
  });

  test("reserved slugs are never produced bare", () => {
    for (const reserved of RESERVED_ORG_SLUGS) {
      const slug = slugifyOrgName(reserved);
      expect(RESERVED_ORG_SLUGS.has(slug)).toBe(false);
    }
    expect(slugifyOrgName("admin")).toBe("admin-org");
    expect(slugifyOrgName("api")).toBe("api-org");
  });

  test("degenerate names fall back to 'org'", () => {
    expect(slugifyOrgName("!!!")).toBe("org");
    expect(slugifyOrgName("")).toBe("org");
  });

  test("slugs are capped in length", () => {
    expect(slugifyOrgName("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});
