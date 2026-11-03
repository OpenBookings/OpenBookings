import { describe, expect, test } from "bun:test";
import { canManageTeam, checkAssignment, checkTarget } from "./rules";

const props = ["p1", "p2"];

describe("canManageTeam", () => {
  test("owners and general managers manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
  });

  test("nobody else does", () => {
    for (const role of ["manager", "reservations", "frontdesk", "finance", "", null, "superuser"]) {
      expect(canManageTeam(role)).toBe(false);
    }
  });
});

describe("checkAssignment", () => {
  test("a general manager cannot make an owner", () => {
    expect(checkAssignment({ actorRole: "admin", role: "owner", propertyIds: [], orgPropertyIds: props })).toEqual({
      ok: false,
      error: "not_allowed",
    });
  });

  test("an owner can make another owner", () => {
    expect(checkAssignment({ actorRole: "owner", role: "owner", propertyIds: [], orgPropertyIds: props }).ok).toBe(true);
  });

  test("a manager cannot hand out anything", () => {
    expect(checkAssignment({ actorRole: "manager", role: "frontdesk", propertyIds: ["p1"], orgPropertyIds: props })).toEqual({
      ok: false,
      error: "not_allowed",
    });
  });

  test("property-scoped roles need at least one of the org's properties", () => {
    expect(checkAssignment({ actorRole: "admin", role: "frontdesk", propertyIds: [], orgPropertyIds: props })).toEqual({
      ok: false,
      error: "choose_properties",
    });
    expect(
      checkAssignment({ actorRole: "admin", role: "frontdesk", propertyIds: ["elsewhere"], orgPropertyIds: props }),
    ).toEqual({ ok: false, error: "unknown_property" });
    expect(
      checkAssignment({ actorRole: "admin", role: "reservations", propertyIds: ["p1", "p1"], orgPropertyIds: props }),
    ).toEqual({ ok: true, role: "reservations", propertyIds: ["p1"] });
  });

  test("org-wide roles get no property rows", () => {
    expect(checkAssignment({ actorRole: "owner", role: "finance", propertyIds: ["p1"], orgPropertyIds: props })).toEqual({
      ok: true,
      role: "finance",
      propertyIds: [],
    });
  });

  test("unknown roles are refused", () => {
    expect(checkAssignment({ actorRole: "owner", role: "member", propertyIds: [], orgPropertyIds: props })).toEqual({
      ok: false,
      error: "unknown_role",
    });
  });
});

describe("checkTarget", () => {
  test("nobody changes their own membership", () => {
    expect(checkTarget({ actorUserId: "u1", actorRole: "owner", targetUserId: "u1", targetRole: "owner" })).toBe(
      "not_yourself",
    );
  });

  test("a general manager cannot touch an owner", () => {
    expect(checkTarget({ actorUserId: "u1", actorRole: "admin", targetUserId: "u2", targetRole: "owner" })).toBe(
      "not_allowed",
    );
    expect(checkTarget({ actorUserId: "u1", actorRole: "admin", targetUserId: "u2", targetRole: "frontdesk" })).toBe(null);
  });

  test("an owner can change another owner", () => {
    expect(checkTarget({ actorUserId: "u1", actorRole: "owner", targetUserId: "u2", targetRole: "owner" })).toBe(null);
  });
});
