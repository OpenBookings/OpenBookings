import { describe, expect, test } from "bun:test";
import { roles, PROPERTY_SCOPED_ROLES, roleAllows, rolesWith } from "./permissions";
import { memberHasPropertyAccess, userCan } from "./index";
import { ABILITIES, ABILITY_GROUPS, ROLE_INFO, ROLE_ORDER, assignableRoles, roleAbilities } from "./role-guide";

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

  test("frontdesk operates bookings but cannot cancel or touch rates", () => {
    expect(roles.frontdesk.authorize({ booking: ["operate"] }).success).toBe(true);
    expect(roles.frontdesk.authorize({ booking: ["cancel"] }).success).toBe(false);
    expect(roles.frontdesk.authorize({ rate: ["update"] }).success).toBe(false);
  });

  test("reservations operate and cancel bookings, but change no rates", () => {
    expect(roles.reservations.authorize({ booking: ["operate", "cancel"] }).success).toBe(true);
    expect(roles.reservations.authorize({ rate: ["update"] }).success).toBe(false);
    expect(roles.reservations.authorize({ property: ["update"] }).success).toBe(false);
  });

  test("goodwill refunds are for owner and general manager only", () => {
    expect(rolesWith({ booking: ["refund"] })).toEqual(["owner", "admin"]);
  });

  test("an owner holds every grant a general manager has", () => {
    for (const [resource, actions] of Object.entries(roles.admin.statements)) {
      expect(roles.owner.authorize({ [resource]: actions } as never).success).toBe(true);
    }
  });

  test("only owner and admin manage members", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(roles[role].authorize({ member: ["invite"] }).success).toBe(true);
      expect(roles[role].authorize({ member: ["remove"] }).success).toBe(true);
    }
    for (const role of ["manager", "reservations", "frontdesk", "finance"] as const) {
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
    expect(PROPERTY_SCOPED_ROLES).toEqual(["manager", "reservations", "frontdesk"]);
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

describe("roleAllows", () => {
  test("property-scoped roles need their property row", () => {
    expect(roleAllows("frontdesk", { booking: ["operate"] }, true)).toBe(true);
    expect(roleAllows("frontdesk", { booking: ["operate"] }, false)).toBe(false);
  });

  test("org-wide roles do not need a property row", () => {
    expect(roleAllows("admin", { booking: ["refund"] }, false)).toBe(true);
    expect(roleAllows("finance", { booking: ["read"] }, false)).toBe(true);
  });

  test("unknown, empty and missing roles fail closed", () => {
    expect(roleAllows("superuser", { booking: ["read"] }, true)).toBe(false);
    expect(roleAllows("", { booking: ["read"] }, true)).toBe(false);
    expect(roleAllows(null, { booking: ["read"] }, true)).toBe(false);
    // Not an own property of the roles object.
    expect(roleAllows("constructor", { booking: ["read"] }, true)).toBe(false);
  });
});

describe("userCan", () => {
  const session = { user: { id: "u1", account_type: "business" } };
  const row = (r: unknown) => (async () => r) as never;

  test("front desk can check in on their property, but not refund", async () => {
    const deps = { queryOne: row({ legacy_owner: false, role: "frontdesk", has_access: true }) };
    expect(await userCan(session, "p1", { booking: ["operate"] }, deps)).toBe(true);
    expect(await userCan(session, "p1", { booking: ["refund"] }, deps)).toBe(false);
  });

  test("a manager cannot refund", async () => {
    const deps = { queryOne: row({ legacy_owner: false, role: "manager", has_access: true }) };
    expect(await userCan(session, "p1", { booking: ["cancel"] }, deps)).toBe(true);
    expect(await userCan(session, "p1", { booking: ["refund"] }, deps)).toBe(false);
  });

  test("a legacy pre-org owner has every grant", async () => {
    const deps = { queryOne: row({ legacy_owner: true, role: null, has_access: false }) };
    expect(await userCan(session, "p1", { booking: ["refund"] }, deps)).toBe(true);
  });

  test("no row, no member and no session all fail closed", async () => {
    expect(await userCan(session, "p1", { booking: ["read"] }, { queryOne: row(null) })).toBe(false);
    const noMember = { queryOne: row({ legacy_owner: false, role: null, has_access: false }) };
    expect(await userCan(session, "p1", { booking: ["read"] }, noMember)).toBe(false);
    expect(await userCan(null, "p1", { booking: ["read"] }, noMember)).toBe(false);
  });
});

describe("role guide", () => {
  test("describes every role, in a fixed order", () => {
    expect([...ROLE_ORDER].sort() as string[]).toEqual(Object.keys(roles).sort());
    for (const role of ROLE_ORDER) expect(ROLE_INFO[role].label.length).toBeGreaterThan(0);
  });

  test("abilities come from the grants", () => {
    const owner = roleAbilities("owner");
    expect(owner.cannot).toEqual([]);
    expect(owner.can.length).toBe(ABILITIES.length);
    expect(roleAbilities("frontdesk").cannot).toContain("Give goodwill refunds");
    expect(roleAbilities("admin").cannot).toEqual(["Close the organisation's account"]);
  });

  test("every role that sees bookings can open guest contact details", () => {
    for (const role of ROLE_ORDER) expect(roleAbilities(role).can).toContain("Open guest contact details");
  });

  test("only owners and general managers change payout settings", () => {
    const allowed = ROLE_ORDER.filter((role) => roleAbilities(role).can.includes("Change payout settings"));
    expect(allowed).toEqual(["owner", "admin"]);
  });

  test("every ability belongs to a listed group", () => {
    for (const ability of ABILITIES) expect(ABILITY_GROUPS).toContain(ability.group);
  });

  test("only owners hand out the owner role", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("admin")).toContain("admin");
    expect(assignableRoles("manager")).toEqual([]);
  });
});
