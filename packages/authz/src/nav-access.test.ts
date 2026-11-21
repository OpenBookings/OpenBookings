import { describe, expect, test } from "bun:test";
import { NAV_ACCESS, NAV_KEYS, navAccess, navKeyForPath, rolesForView, type AccessLevel, type NavKey } from "./nav-access";

const PROPERTY_BOUND: NavKey[] = [
  "overview",
  "reservations",
  "messages",
  "reviews",
  "property",
  "rooms",
  "rates",
  "pricingRules",
  "analytics",
];

function every(level: AccessLevel): Record<NavKey, AccessLevel> {
  return Object.fromEntries(NAV_KEYS.map((key) => [key, level])) as Record<NavKey, AccessLevel>;
}

describe("NAV_ACCESS", () => {
  test("covers every menu key, view as any-of", () => {
    expect(Object.keys(NAV_ACCESS).sort()).toEqual([...NAV_KEYS].sort());
    expect(NAV_ACCESS.analytics.view).toEqual([{ payout: ["read"] }, { rate: ["update"] }]);
    expect(NAV_ACCESS.team).toEqual({ view: "member", edit: { member: ["invite"] } });
    expect(NAV_ACCESS.property).toEqual({ view: "member", edit: { property: ["update"] } });
    expect(NAV_ACCESS.overview.edit).toBeUndefined();
  });
});

describe("navAccess", () => {
  test("frontdesk with access: rates view, payouts none, analytics none, team view", () => {
    const access = navAccess("frontdesk", true);
    expect(access.rates).toBe("view");
    expect(access.pricingRules).toBe("view");
    expect(access.payouts).toBe("none");
    expect(access.billing).toBe("none");
    expect(access.analytics).toBe("none");
    expect(access.team).toBe("view");
    expect(access.reservations).toBe("edit");
    expect(access.overview).toBe("edit");
    expect(access.property).toBe("view");
    expect(access.rooms).toBe("view");
  });

  test("finance: reservations view, payouts view, billing edit", () => {
    const access = navAccess("finance", false);
    expect(access.reservations).toBe("view");
    expect(access.messages).toBe("view");
    expect(access.reviews).toBe("view");
    expect(access.payouts).toBe("view");
    expect(access.billing).toBe("edit");
    expect(access.analytics).toBe("edit");
    expect(access.rates).toBe("view");
    expect(access.property).toBe("view");
    expect(access.team).toBe("view");
  });

  test("manager without property access: everything property-bound none", () => {
    const access = navAccess("manager", false);
    for (const key of PROPERTY_BOUND) expect([key, access[key]]).toEqual([key, "none"]);
    expect(access.team).toBe("view");
    expect(access.payouts).toBe("none");
    expect(access.billing).toBe("none");
  });

  test("manager with property access runs the property but not the money or the team", () => {
    const access = navAccess("manager", true);
    expect(access.property).toBe("edit");
    expect(access.rooms).toBe("edit");
    expect(access.rates).toBe("edit");
    expect(access.pricingRules).toBe("edit");
    expect(access.analytics).toBe("edit");
    expect(access.reservations).toBe("edit");
    expect(access.payouts).toBe("none");
    expect(access.team).toBe("view");
  });

  test("owner: everything edit, with or without a property_access row", () => {
    expect(navAccess("owner", true)).toEqual(every("edit"));
    expect(navAccess("owner", false)).toEqual(every("edit"));
    expect(navAccess("admin", false)).toEqual(every("edit"));
  });

  test("unknown or missing role: everything none", () => {
    expect(navAccess("guest", true)).toEqual(every("none"));
    expect(navAccess("member", true)).toEqual(every("none"));
    expect(navAccess(null, true)).toEqual(every("none"));
    expect(navAccess("", true)).toEqual(every("none"));
    expect(navAccess(" , ", true)).toEqual(every("none"));
  });

  test("a comma-separated role gets the best level any of its roles has", () => {
    const access = navAccess("frontdesk, finance", true);
    expect(access.reservations).toBe("edit");
    expect(access.payouts).toBe("view");
    expect(access.billing).toBe("edit");
    expect(access.analytics).toBe("edit");
    expect(access.rates).toBe("view");
  });

  test("an unknown role next to a known one does not widen or block", () => {
    expect(navAccess("guest,reservations", true)).toEqual(navAccess("reservations", true));
  });
});

describe("rolesForView", () => {
  test("lists the roles that can open a key, in team order", () => {
    expect(rolesForView("payouts")).toEqual(["owner", "admin", "finance"]);
    expect(rolesForView("analytics")).toEqual(["owner", "admin", "manager", "finance"]);
    expect(rolesForView("team")).toEqual(["owner", "admin", "manager", "reservations", "frontdesk", "finance"]);
  });
});

describe("navKeyForPath", () => {
  test.each([
    ["/dashboard", "overview"],
    ["/dashboard/", "overview"],
    ["/dashboard/bookings/reservations", "reservations"],
    ["/dashboard/bookings/messages", "messages"],
    ["/dashboard/bookings/reviews", "reviews"],
    ["/dashboard/listings/property", "property"],
    ["/dashboard/listings/rooms", "rooms"],
    ["/dashboard/listings/rooms/2b1c", "rooms"],
    ["/dashboard/listings/rates-availability", "rates"],
    ["/dashboard/listings/pricing-rules", "pricingRules"],
    ["/dashboard/listings/pricing-rules/new", "pricingRules"],
    ["/dashboard/analytics", "analytics"],
    ["/dashboard/analytics/revenue", "analytics"],
    ["/dashboard/analytics/booking-patterns", "analytics"],
    ["/dashboard/finance", "payouts"],
    ["/dashboard/finance/billing", "billing"],
    ["/dashboard/team", "team"],
    ["/dashboard/team?tab=roles", "team"],
  ] as const)("%s → %s", (path, key) => {
    expect(navKeyForPath(path)).toBe(key);
  });

  test.each(["/account", "/support", "/dashboard/bookings", "/dashboard/listings", "/dashboard/teams", "/elsewhere"])(
    "%s → null",
    (path) => {
      expect(navKeyForPath(path)).toBeNull();
    },
  );
});
