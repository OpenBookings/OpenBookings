import { describe, expect, test } from "bun:test";
import { roles, PROPERTY_SCOPED_ROLES } from "./permissions";
import { memberHasPropertyAccess } from "./index";

describe("role grants", () => {
  test("owner may delete the org; admin may not", () => {
    expect(roles.owner.authorize({ org: ["delete"] }).success).toBe(true);
    expect(roles.admin.authorize({ org: ["delete"] }).success).toBe(false);
  });

  test("owner and admin may update payouts; finance may only read", () => {
    expect(roles.owner.authorize({ payout: ["update"] }).success).toBe(true);
    expect(roles.admin.authorize({ payout: ["update"] }).success).toBe(true);
    expect(roles.finance.authorize({ payout: ["read"] }).success).toBe(true);
    expect(roles.finance.authorize({ payout: ["update"] }).success).toBe(false);
  });

  test("manager runs a property but touches no payouts or members", () => {
    expect(roles.manager.authorize({ property: ["update"] }).success).toBe(true);
    expect(roles.manager.authorize({ booking: ["cancel"] }).success).toBe(true);
    expect(roles.manager.authorize({ payout: ["read"] }).success).toBe(false);
    expect(roles.manager.authorize({ member: ["invite"] }).success).toBe(false);
    expect(roles.manager.authorize({ property: ["delete"] }).success).toBe(false);
  });

  test("frontdesk modifies bookings but cannot cancel or touch rates", () => {
    expect(roles.frontdesk.authorize({ booking: ["modify"] }).success).toBe(true);
    expect(roles.frontdesk.authorize({ booking: ["cancel"] }).success).toBe(false);
    expect(roles.frontdesk.authorize({ rate: ["update"] }).success).toBe(false);
  });

  test("only owner and admin manage members", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(roles[role].authorize({ member: ["invite"] }).success).toBe(true);
      expect(roles[role].authorize({ member: ["remove"] }).success).toBe(true);
    }
    for (const role of ["manager", "frontdesk", "finance"] as const) {
      expect(roles[role].authorize({ member: ["invite"] }).success).toBe(false);
    }
  });
});

describe("memberHasPropertyAccess", () => {
  const neverQuery = async () => {
    throw new Error("org-wide roles must not hit the database");
  };

  test("org-wide roles pass without a property_access row", async () => {
    for (const role of ["owner", "admin", "finance"]) {
      expect(
        await memberHasPropertyAccess({ id: "m1", role }, "p1", {
          queryOne: neverQuery as never,
        }),
      ).toBe(true);
    }
  });

  test("property-scoped roles require a property_access row", async () => {
    expect(PROPERTY_SCOPED_ROLES).toEqual(["manager", "frontdesk"]);
    const withRow = async () => ({ ok: true }) as never;
    const withoutRow = async () => null;
    expect(
      await memberHasPropertyAccess({ id: "m1", role: "manager" }, "p1", {
        queryOne: withRow,
      }),
    ).toBe(true);
    expect(
      await memberHasPropertyAccess({ id: "m1", role: "frontdesk" }, "p1", {
        queryOne: withoutRow,
      }),
    ).toBe(false);
  });

  test("unknown roles and missing ids fail closed", async () => {
    expect(
      await memberHasPropertyAccess({ id: "m1", role: "superuser" }, "p1"),
    ).toBe(false);
    expect(
      await memberHasPropertyAccess({ id: "", role: "owner" }, "p1"),
    ).toBe(false);
    expect(
      await memberHasPropertyAccess({ id: "m1", role: "owner" }, ""),
    ).toBe(false);
  });
});
