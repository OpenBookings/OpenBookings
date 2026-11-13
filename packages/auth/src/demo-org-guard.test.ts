import { describe, expect, test } from "bun:test";
import { DEMO_ORG_ID, DEMO_ORG_SLUG } from "@openbookings/mode";
import { demoOrgReadRefused, refuseDemoOrg } from "./demo-org-guard";

describe("refuseDemoOrg", () => {
  test("throws FORBIDDEN for the demo organisation", () => {
    expect(() => refuseDemoOrg(DEMO_ORG_ID)).toThrow(
      expect.objectContaining({ status: "FORBIDDEN" }),
    );
  });

  test("lets real organisations and missing ids through", () => {
    expect(() => refuseDemoOrg("org_real")).not.toThrow();
    expect(() => refuseDemoOrg(undefined)).not.toThrow();
    expect(() => refuseDemoOrg(null)).not.toThrow();
  });
});

describe("demoOrgReadRefused", () => {
  test("refuses listing members of the demo organisation", () => {
    expect(demoOrgReadRefused("/organization/list-members", { organizationId: DEMO_ORG_ID }, undefined)).toBe(true);
    expect(demoOrgReadRefused("/organization/get-full-organization", undefined, { organizationId: DEMO_ORG_ID })).toBe(true);
  });

  test("allows real organisations and other paths", () => {
    expect(demoOrgReadRefused("/organization/list-members", { organizationId: "org_real" }, undefined)).toBe(false);
    expect(demoOrgReadRefused("/organization/remove-member", { organizationId: DEMO_ORG_ID }, undefined)).toBe(false);
  });

  test("refuses the demo slug in the query or body", () => {
    expect(demoOrgReadRefused("/organization/list-members", { organizationSlug: DEMO_ORG_SLUG }, undefined)).toBe(true);
    expect(demoOrgReadRefused("/organization/get-full-organization", undefined, { organizationSlug: DEMO_ORG_SLUG })).toBe(true);
  });

  test("refuses when no id or slug is given and the active organisation is the demo", () => {
    expect(demoOrgReadRefused("/organization/list-members", {}, undefined, DEMO_ORG_ID)).toBe(true);
  });

  test("allows an active real organisation and a real slug", () => {
    expect(demoOrgReadRefused("/organization/list-members", {}, undefined, "org_real")).toBe(false);
    expect(demoOrgReadRefused("/organization/list-members", { organizationSlug: "real-hotel" }, undefined, DEMO_ORG_ID)).toBe(false);
  });
});
