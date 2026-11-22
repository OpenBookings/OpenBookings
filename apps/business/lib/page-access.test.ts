import { describe, expect, test } from "bun:test";
import type { CurrentProperty } from "@openbookings/authz";
import { navAccess } from "@openbookings/authz/nav-access";
import { canManageTeam } from "@/lib/team/rules";
import { mockModules } from "@/lib/mock-modules";

await mockModules(import.meta.dir, { "@/lib/auth": () => ({ getServerSession: async () => null }) }, ["@/lib/auth"]);

const { accessLevel, accessLevels, listSentence, loadOrgAdmins, noAccessProps } = await import("./page-access");
const { noAccessCopy } = await import("@/components/dashboard/no-access");

const hotel = (role: string, hasPropertyAccess = true): CurrentProperty => ({
  propertyId: "11111111-1111-4111-8111-111111111111",
  propertyName: "Hotel Aurora",
  logoUrl: null,
  organizationId: "org-1",
  organizationName: "Aurora BV",
  role,
  hasPropertyAccess,
});

describe("accessLevel", () => {
  test("reads the role at the current hotel from the table", () => {
    expect(accessLevel(hotel("frontdesk"), "payouts")).toBe("none");
    expect(accessLevel(hotel("frontdesk"), "rates")).toBe("view");
    expect(accessLevel(hotel("manager", false), "rates")).toBe("none");
    expect(accessLevel(hotel("owner", false), "billing")).toBe("edit");
  });

  test("no current hotel: pages keep their own empty states", () => {
    expect(accessLevel(null, "property")).toBe("edit");
    expect(accessLevel(null, "payouts")).toBe("edit");
  });
});

describe("accessLevels", () => {
  test("every page at the current hotel, for the sidebar", () => {
    expect(accessLevels(hotel("frontdesk"))).toEqual(navAccess("frontdesk", true));
  });

  test("no current hotel: nothing is greyed out", () => {
    expect(Object.values(accessLevels(null)).every((level) => level === "edit")).toBe(true);
  });
});

describe("team management follows the table", () => {
  test.each(["owner", "admin", "manager", "reservations", "frontdesk", "finance", "owner,finance", "guest"])(
    "%s",
    (role) => {
      expect(canManageTeam(role)).toBe(navAccess(role, true).team === "edit");
    },
  );
});

describe("listSentence", () => {
  test("joins like a sentence", () => {
    expect(listSentence([])).toBe("");
    expect(listSentence(["Owner"])).toBe("Owner");
    expect(listSentence(["Owner", "Back office"])).toBe("Owner and Back office");
    expect(listSentence(["Owner", "General manager", "Back office"])).toBe("Owner, General manager and Back office");
  });
});

describe("loadOrgAdmins", () => {
  test("asks for the org's owners and general managers, by name or email", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const names = await loadOrgAdmins("org-1", {
      query: async <T,>(sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return [{ name: "Anna de Vries" }, { name: "bob@example.com" }] as T[];
      },
    });
    expect(names).toEqual(["Anna de Vries", "bob@example.com"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(["org-1"]);
    expect(calls[0]!.sql).toContain(`m."organizationId" = $1`);
    expect(calls[0]!.sql).toContain("'owner'");
    expect(calls[0]!.sql).toContain("'admin'");
    expect(calls[0]!.sql).toContain("u.email");
  });
});

describe("no-access copy", () => {
  test("names the hotel, the role, who can open it and whom to ask", async () => {
    const props = await noAccessProps("payouts", hotel("frontdesk"), {
      query: async <T,>() => [{ name: "Anna de Vries" }, { name: "Bob" }] as T[],
    });
    expect(props).toEqual({
      hotelName: "Hotel Aurora",
      roleLabel: "Front desk",
      pageName: "Payouts",
      neededRoles: ["Owner", "General manager", "Back office"],
      admins: ["Anna de Vries", "Bob"],
    });
    expect(noAccessCopy(props)).toEqual({
      title: "No access at Hotel Aurora",
      body: "Your role at Hotel Aurora (Front desk) can't open Payouts. Owner, General manager and Back office can. Ask Anna de Vries or Bob for access.",
    });
  });

  test("leaves out whom to ask when nobody is found", () => {
    expect(
      noAccessCopy({
        hotelName: "Hotel Aurora",
        roleLabel: "Manager",
        pageName: "Rates & availability",
        neededRoles: ["Owner", "General manager"],
        admins: [],
      }).body,
    ).toBe("Your role at Hotel Aurora (Manager) can't open Rates & availability. Owner and General manager can.");
  });

  test("a comma-separated role reads as a list", async () => {
    const props = await noAccessProps("payouts", hotel("frontdesk,reservations"), { query: async <T,>() => [] as T[] });
    expect(props.roleLabel).toBe("Front desk and Reservations");
  });
});
