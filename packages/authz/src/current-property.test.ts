import { describe, expect, test } from "bun:test";
import {
  listSwitchableProperties,
  pickCurrentProperty,
  resolveCurrentProperty,
  setCurrentProperty,
  type SwitchableProperty,
} from "./current-property";
import { propertyReadAccessSql } from "./index";

const DEMO = "demo-organisation";

function hotel(propertyId: string, organizationId: string, extra: Partial<SwitchableProperty> = {}): SwitchableProperty {
  return {
    propertyId,
    propertyName: `Hotel ${propertyId}`,
    logoUrl: null,
    organizationId,
    organizationName: `Org ${organizationId}`,
    role: "owner",
    hasPropertyAccess: false,
    ...extra,
  };
}

/** Row as the list query returns it: snake_case, straight from Postgres. */
function row(h: SwitchableProperty) {
  return {
    property_id: h.propertyId,
    property_name: h.propertyName,
    logo_url: h.logoUrl,
    organization_id: h.organizationId,
    organization_name: h.organizationName,
    role: h.role,
    has_property_access: h.hasPropertyAccess,
  };
}

const a1 = hotel("a1", "org-a");
const a2 = hotel("a2", "org-a");
const b1 = hotel("b1", "org-b");
const demo1 = hotel("d1", DEMO);

describe("pickCurrentProperty", () => {
  test("picks the stored property when it is still reachable in the stored org", () => {
    const current = pickCurrentProperty([a1, a2, b1], { activePropertyId: "a2", activeOrganizationId: "org-a" });
    expect(current).toEqual(a2);
  });

  test("ignores a stored property that belongs to a different org than the stored org", () => {
    const current = pickCurrentProperty([a1, a2, b1], { activePropertyId: "b1", activeOrganizationId: "org-a" });
    expect(current).toEqual(a1);
  });

  test("falls back to the first hotel of the stored org when the stored property is gone", () => {
    const current = pickCurrentProperty([b1, a1, a2], { activePropertyId: "gone", activeOrganizationId: "org-a" });
    expect(current).toEqual(a1);
  });

  test("falls back to the first hotel overall when the stored org is gone", () => {
    // Review Focus 2: removed from org B while B was current.
    const current = pickCurrentProperty([a1, a2, demo1], { activePropertyId: "b1", activeOrganizationId: "org-b" });
    expect(current).toEqual(a1);
  });

  test("returns null for a user with no reachable hotel", () => {
    expect(pickCurrentProperty([], { activePropertyId: "a1", activeOrganizationId: "org-a" })).toBeNull();
    expect(pickCurrentProperty([], { activePropertyId: null, activeOrganizationId: null })).toBeNull();
  });
});

describe("listSwitchableProperties", () => {
  function capture(rows: unknown[] = []) {
    const seen: { sql: string; values: unknown[] }[] = [];
    const query = async <T>(sql: string, values: unknown[] = []): Promise<T[]> => {
      seen.push({ sql, values });
      return rows as T[];
    };
    return { seen, query };
  }

  test("lists own orgs before the demo org", async () => {
    // Review Focus 1: in testing mode every host is also in the demo org.
    const fake = capture([row(a1), row(demo1)]);
    const list = await listSwitchableProperties("u1", { query: fake.query, testing: true });
    expect(list).toEqual([a1, demo1]);
    expect(fake.seen).toHaveLength(1);
    const { sql, values } = fake.seen[0]!;
    expect(values).toEqual(["u1"]);
    expect(sql).toMatch(new RegExp(`ORDER BY \\(o\\.id = '${DEMO}'\\),\\s*o\\.name,\\s*p\\.name`));
    // Testing mode: the demo org is reachable, so no exclusion literal.
    expect(sql).not.toContain(`<> '${DEMO}'`);
    expect(sql).toContain(propertyReadAccessSql("$1", true));
    // With the demo org last, the fallback lands a one-hotel host on their own hotel.
    expect(pickCurrentProperty(list, { activePropertyId: null, activeOrganizationId: null })).toEqual(a1);
  });

  test("excludes the demo org outside testing mode", async () => {
    const fake = capture();
    await listSwitchableProperties("u1", { query: fake.query, testing: false });
    const { sql } = fake.seen[0]!;
    expect(sql).toContain(propertyReadAccessSql("$1", false));
    // The member row picked for role/hasPropertyAccess must exclude it too.
    expect(sql.split(`m."organizationId" <> '${DEMO}'`).length - 1).toBeGreaterThanOrEqual(2);
  });

  test("only lists properties that belong to an organization, with their logo and access flag", async () => {
    const withLogo = hotel("a3", "org-a", { logoUrl: "https://cdn/logo.png", role: "front_desk", hasPropertyAccess: true });
    const fake = capture([row(withLogo)]);
    const list = await listSwitchableProperties("u1", { query: fake.query, testing: false });
    expect(list).toEqual([withLogo]);
    const { sql } = fake.seen[0]!;
    expect(sql).toContain("p.organization_id IS NOT NULL");
    expect(sql).toContain(`i."group" = 'logo'`);
    expect(sql).toContain("property_access");
  });

  test("returns nothing for an empty user id without querying", async () => {
    const fake = capture([row(a1)]);
    expect(await listSwitchableProperties("", { query: fake.query })).toEqual([]);
    expect(fake.seen).toHaveLength(0);
  });
});

describe("resolveCurrentProperty", () => {
  test("reads the stored pointers from the session row bound to the user", async () => {
    let sessionSql = "";
    let sessionValues: unknown[] = [];
    const current = await resolveCurrentProperty(
      { userId: "u1", sessionId: "s1" },
      {
        testing: true,
        query: async <T>() => [row(a1), row(a2)] as T[],
        queryOne: async <T>(sql: string, values: unknown[] = []) => {
          sessionSql = sql;
          sessionValues = values;
          return { activePropertyId: "a2", activeOrganizationId: "org-a" } as T;
        },
      },
    );
    expect(sessionSql).toMatch(/FROM "session"\s+WHERE id = \$1 AND "userId" = \$2/);
    expect(sessionValues).toEqual(["s1", "u1"]);
    expect(current).toEqual({ current: a2, stored: { activePropertyId: "a2", activeOrganizationId: "org-a" } });
  });

  test("treats a missing session row as nothing stored", async () => {
    const result = await resolveCurrentProperty(
      { userId: "u1", sessionId: "someone-elses" },
      { testing: true, query: async <T>() => [row(b1)] as T[], queryOne: async () => null },
    );
    expect(result).toEqual({ current: b1, stored: { activePropertyId: null, activeOrganizationId: null } });
  });
});

describe("setCurrentProperty", () => {
  test("setCurrentProperty refuses a property the user cannot read and writes nothing", async () => {
    let wrote = false;
    const result = await setCurrentProperty({ userId: "u1", sessionId: "s1" }, "b1", {
      testing: true,
      query: async <T>() => [row(a1)] as T[],
      queryOne: async () => ((wrote = true), null),
    });
    expect(result).toBeNull();
    expect(wrote).toBe(false);
  });

  test("setCurrentProperty writes property and its org in one statement", async () => {
    const writes: { sql: string; values: unknown[] }[] = [];
    const result = await setCurrentProperty({ userId: "u1", sessionId: "s1" }, "b1", {
      testing: true,
      query: async <T>() => [row(a1), row(b1)] as T[],
      queryOne: async <T>(sql: string, values: unknown[] = []) => {
        writes.push({ sql, values });
        return { id: "s1" } as T;
      },
    });
    expect(result).toEqual(b1);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(
      /UPDATE "session"\s+SET "activePropertyId" = \$1, "activeOrganizationId" = \$2\s+WHERE id = \$3 AND "userId" = \$4/,
    );
    expect(writes[0]!.values).toEqual(["b1", "org-b", "s1", "u1"]);
  });

  test("setCurrentProperty returns null when the session row is not the user's", async () => {
    const result = await setCurrentProperty({ userId: "u1", sessionId: "other" }, "a1", {
      testing: true,
      query: async <T>() => [row(a1)] as T[],
      queryOne: async () => null,
    });
    expect(result).toBeNull();
  });
});
