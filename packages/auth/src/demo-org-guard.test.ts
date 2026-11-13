import { describe, expect, test } from "bun:test";
import { DEMO_ORG_ID } from "@openbookings/mode";
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
});
