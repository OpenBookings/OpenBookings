import { describe, expect, mock, test } from "bun:test";
import {
  CURRENT_PROPERTY_SQL,
  currentPropertySql,
  getPropertyScopedDb,
  PROPERTY_EDIT_ACCESS_SQL,
  propertyReadAccessSql,
  getHostScopedDb,
  getOrgScopedDb,
  userCan,
  getThreadForParticipant,
  userOwnsProperty,
  userOwnsRatePlan,
  userOwnsRoom,
} from "./index";
import type { SessionLike, ThreadRow } from "./index";

const sessionFor = (id: string, accountType = "business"): SessionLike => ({
  user: { id, account_type: accountType },
});

/**
 * Fake DB: one property owned by user "host-a" containing room "room-1",
 * plus an unowned property (owner_user_id NULL) containing "room-orphan".
 * Mirrors the two real queries in src/index.ts.
 */
const properties = [
  { id: "prop-1", owner: "host-a" },
  { id: "prop-null", owner: null },
];
const rooms = [
  { id: "room-1", propertyId: "prop-1" },
  { id: "room-orphan", propertyId: "prop-null" },
];
const ratePlans = [
  { id: "plan-1", roomId: "room-1" },
  { id: "plan-orphan", roomId: "room-orphan" },
];

/** Mirrors the message_threads row shape queried in getThreadForParticipant. */
const threads: ThreadRow[] = [
  {
    id: "thread-1",
    booking_id: "booking-1",
    property_id: "prop-1",
    host_id: "host-a",
    guest_id: "guest-a",
    status: "open",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

const fakeQueryOne = async <T>(text: string, values: unknown[] = []): Promise<T | null> => {
  // First: the thread query mentions `FROM properties` in its access check.
  if (text.includes("FROM message_threads")) {
    const [threadId, userId] = values as [string, string];
    const thread = threads.find(
      (t) => t.id === threadId && (t.host_id === userId || t.guest_id === userId),
    );
    return (thread ?? null) as T | null;
  }
  if (text.includes("FROM properties")) {
    const [propertyId, userId] = values as [string, string];
    const hit = properties.find((p) => p.id === propertyId && p.owner === userId);
    return (hit ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM rate_plans")) {
    const [ratePlanId, userId] = values as [string, string];
    const plan = ratePlans.find((rp) => rp.id === ratePlanId);
    const room = rooms.find((r) => r.id === plan?.roomId);
    const owner = properties.find((p) => p.id === room?.propertyId)?.owner;
    return (plan && owner === userId ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM rooms")) {
    const [roomId, userId] = values as [string, string];
    const room = rooms.find((r) => r.id === roomId);
    const owner = properties.find((p) => p.id === room?.propertyId)?.owner;
    return (room && owner === userId ? { ok: true } : null) as T | null;
  }
  throw new Error(`unexpected query: ${text}`);
};

const deps = { queryOne: fakeQueryOne };

describe("userOwnsProperty", () => {
  test("owner is allowed", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "prop-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsProperty(sessionFor("host-b"), "prop-1", deps)).toBe(false);
  });

  test("unowned property (NULL owner) is inaccessible to everyone", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "prop-null", deps)).toBe(false);
  });

  test("unknown property fails closed", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsProperty(null, "prop-1", deps)).toBe(false);
    expect(await userOwnsProperty(undefined, "prop-1", deps)).toBe(false);
  });

  test("empty ids fail closed", async () => {
    expect(await userOwnsProperty(sessionFor(""), "prop-1", deps)).toBe(false);
    expect(await userOwnsProperty(sessionFor("host-a"), "", deps)).toBe(false);
  });
});

describe("userOwnsRoom (resolves through property ownership)", () => {
  test("property owner owns the room", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "room-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsRoom(sessionFor("host-b"), "room-1", deps)).toBe(false);
  });

  test("room in unowned property is inaccessible", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "room-orphan", deps)).toBe(false);
  });

  test("unknown room fails closed", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsRoom(null, "room-1", deps)).toBe(false);
  });
});

describe("getThreadForParticipant", () => {
  test("host participant is allowed and identified as host", async () => {
    const result = await getThreadForParticipant(sessionFor("host-a"), "thread-1", deps);
    expect(result?.role).toBe("host");
    expect(result?.thread.id).toBe("thread-1");
  });

  test("guest participant is allowed and identified as guest", async () => {
    const result = await getThreadForParticipant(sessionFor("guest-a"), "thread-1", deps);
    expect(result?.role).toBe("guest");
    expect(result?.thread.id).toBe("thread-1");
  });

  test("BOLA: an authenticated user who is neither host nor guest is rejected", async () => {
    expect(await getThreadForParticipant(sessionFor("host-b"), "thread-1", deps)).toBeNull();
  });

  test("unknown thread fails closed", async () => {
    expect(await getThreadForParticipant(sessionFor("host-a"), "nope", deps)).toBeNull();
  });

  test("missing session fails closed", async () => {
    expect(await getThreadForParticipant(null, "thread-1", deps)).toBeNull();
    expect(await getThreadForParticipant(undefined, "thread-1", deps)).toBeNull();
  });

  test("empty ids fail closed", async () => {
    expect(await getThreadForParticipant(sessionFor(""), "thread-1", deps)).toBeNull();
    expect(await getThreadForParticipant(sessionFor("host-a"), "", deps)).toBeNull();
  });
});

describe("getHostScopedDb", () => {
  test("rejects missing session", () => {
    expect(() => getHostScopedDb(null)).toThrow();
    expect(() => getHostScopedDb(undefined)).toThrow();
  });

  test("rejects non-business sessions", () => {
    expect(() => getHostScopedDb(sessionFor("guest-1", "private"))).toThrow(
      /business/,
    );
  });

  test("derives scope from the session, exposing it as ownerUserId", () => {
    const host = getHostScopedDb(sessionFor("host-a"));
    expect(host.ownerUserId).toBe("host-a");
  });
});

describe("userOwnsRatePlan", () => {
  test("owner of the parent property is allowed", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "plan-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-b"), "plan-1", deps)).toBe(false);
  });

  test("plan under an unowned property is inaccessible", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "plan-orphan", deps)).toBe(false);
  });

  test("unknown rate plan fails closed", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsRatePlan(null, "plan-1", deps)).toBe(false);
  });
});

describe("propertyReadAccessSql", () => {
  test("binds the user only through the given parameter", () => {
    const sql = propertyReadAccessSql("$3");
    expect(sql).toContain("p.owner_user_id = $3");
    expect(sql).toContain('m."userId" = $3');
    expect(sql).not.toContain("$1");
  });

  test("org-wide roles read everything; scoped roles need property_access; unknown roles nothing", () => {
    const sql = propertyReadAccessSql("$1");
    expect(sql).toMatch(/m\.role IN \('owner', 'admin', 'finance'\)/);
    expect(sql).toMatch(/m\.role IN \('manager', 'reservations', 'frontdesk'\) AND EXISTS/);
  });

  test("refuses anything but a bind parameter", () => {
    expect(() => propertyReadAccessSql("'x' OR 1=1")).toThrow("Not a bind parameter");
  });
});

describe("legacy owner_user_id", () => {
  // Regression: owner_user_id is stamped at onboarding and never cleared, so a
  // standalone `p.owner_user_id = $n` branch let a removed or demoted founder
  // keep edit, cancel and refund rights. It may only count for pre-org rows.
  const standalone = /(?<!organization_id IS NULL AND )p\.owner_user_id = \$\d+/;

  test("edit predicate only trusts owner_user_id when the property has no org", () => {
    expect(PROPERTY_EDIT_ACCESS_SQL).toContain("(p.organization_id IS NULL AND p.owner_user_id = $2)");
    expect(PROPERTY_EDIT_ACCESS_SQL.replace("(p.organization_id IS NULL AND p.owner_user_id = $2)", "")).not.toMatch(
      standalone,
    );
  });

  test("read predicate only trusts owner_user_id when the property has no org", () => {
    const sql = propertyReadAccessSql("$1");
    expect(sql).toContain("(p.organization_id IS NULL AND p.owner_user_id = $1)");
    expect(sql.replace("(p.organization_id IS NULL AND p.owner_user_id = $1)", "")).not.toMatch(standalone);
  });
});

describe("getThreadForParticipant — the host side needs current access", () => {
  test("the query ties the host to current read access on the thread's property", async () => {
    let sql = "";
    await getThreadForParticipant(sessionFor("host-a"), "thread-1", {
      queryOne: async <T>(text: string) => {
        sql = text;
        return null as T | null;
      },
    });
    // guest_id alone is enough for the guest...
    expect(sql).toMatch(/t\.guest_id = \$2\s+OR \(t\.host_id = \$2 AND EXISTS/);
    // ...but a host must still be able to read the property (org membership, or
    // legacy ownership of an org-less row), not merely be the stamped host_id.
    expect(sql).toContain("p.id = t.property_id");
    expect(sql).toContain(propertyReadAccessSql("$2"));
  });
});

describe("getOrgScopedDb org guard", () => {
  test("refuses the demo organisation outside testing mode, before looking at membership", async () => {
    let looked = false;
    const db = await getOrgScopedDb(
      { user: { id: "u1", account_type: "business" }, session: { activeOrganizationId: "demo-organisation" } },
      { testing: false, queryOne: async () => ((looked = true), { role: "owner" } as never) },
    );
    expect(db).toBeNull();
    expect(looked).toBe(false);
  });
});

describe("demo organisation in testing mode", () => {
  const session = { user: { id: "u1", account_type: "business" }, session: { activeOrganizationId: "demo-organisation" } };

  test("getOrgScopedDb allows it when testing is on", async () => {
    const db = await getOrgScopedDb(session, { testing: true, queryOne: async () => ({ role: "owner" }) as never });
    expect(db?.organizationId).toBe("demo-organisation");
  });

  test("userCan binds the testing decision as the third parameter", async () => {
    for (const testing of [true, false]) {
      let values: unknown[] = [];
      await userCan(session, "p1", { property: ["update"] }, {
        testing,
        queryOne: async (_sql: string, v?: unknown[]) => ((values = v ?? []), null) as never,
      });
      expect(values).toEqual(["p1", "u1", testing]);
    }
  });
});

describe("getPropertyScopedDb", () => {
  test("binds user then property, then the caller's values", async () => {
    const calls: unknown[][] = [];
    mock.module("@openbookings/db", () => ({
      query: async (_t: string, v: unknown[]) => (calls.push(v), []),
      queryOne: async (_t: string, v: unknown[]) => (calls.push(v), null),
    }));
    const fresh = getPropertyScopedDb;
    const db = fresh(sessionFor("host-a"), "prop-1");
    expect(db.ownerUserId).toBe("host-a");
    expect(db.propertyId).toBe("prop-1");
    await db.query("SELECT 1", ["x"]);
    await db.queryOne("SELECT 1");
    expect(calls).toEqual([["host-a", "prop-1", "x"], ["host-a", "prop-1"]]);
  });

  test("throws on missing session, non-business session and empty property", () => {
    expect(() => getPropertyScopedDb(null, "prop-1")).toThrow();
    expect(() => getPropertyScopedDb(sessionFor("g", "private"), "prop-1")).toThrow(/business/);
    expect(() => getPropertyScopedDb(sessionFor("host-a"), "")).toThrow();
  });

  test("CURRENT_PROPERTY_SQL pins $2 and checks read access for $1", () => {
    expect(CURRENT_PROPERTY_SQL).toBe(currentPropertySql());
    expect(CURRENT_PROPERTY_SQL.startsWith("p.id = $2::uuid AND ")).toBe(true);
    expect(CURRENT_PROPERTY_SQL).toContain(propertyReadAccessSql("$1"));
  });
});

describe("currentPropertyId guard", () => {
  const CURRENT = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const capture = () => {
    const seen: { sql: string; values: unknown[] }[] = [];
    const queryOne = async (sql: string, values: unknown[] = []) => {
      seen.push({ sql, values });
      // The fake DB resolves to CURRENT only; a guard on another id matches nothing.
      const guarded = values.find((v, i) => i >= 2 && typeof v === "string" && v.includes("-"));
      return (guarded && guarded !== CURRENT ? null : { ok: true, legacy_owner: true, role: null, has_access: false }) as never;
    };
    return { seen, queryOne };
  };

  test("userCan is false when the property is not the current one", async () => {
    const { seen, queryOne } = capture();
    expect(await userCan(sessionFor("u1"), CURRENT, { property: ["update"] }, { queryOne, currentPropertyId: OTHER })).toBe(false);
    expect(seen[0].sql).toContain("AND p.id = $4::uuid");
    expect(seen[0].values).toEqual([CURRENT, "u1", expect.any(Boolean), OTHER]);
    expect(await userCan(sessionFor("u1"), CURRENT, { property: ["update"] }, { queryOne, currentPropertyId: CURRENT })).toBe(true);
  });

  test("userOwnsRoom is false when the room's property is not the current one", async () => {
    const { seen, queryOne } = capture();
    expect(await userOwnsRoom(sessionFor("u1"), "room-1", { queryOne, currentPropertyId: OTHER })).toBe(false);
    expect(seen[0].sql).toContain("AND p.id = $3::uuid");
    expect(seen[0].values).toEqual(["room-1", "u1", OTHER]);
    expect(await userOwnsRoom(sessionFor("u1"), "room-1", { queryOne, currentPropertyId: CURRENT })).toBe(true);
  });

  test("userOwnsProperty and userOwnsRatePlan add the same guard", async () => {
    const { seen, queryOne } = capture();
    expect(await userOwnsProperty(sessionFor("u1"), CURRENT, { queryOne, currentPropertyId: OTHER })).toBe(false);
    expect(await userOwnsRatePlan(sessionFor("u1"), "plan-1", { queryOne, currentPropertyId: OTHER })).toBe(false);
    for (const s of seen) expect(s.sql).toContain("AND p.id = $3::uuid");
  });

  test("absent currentPropertyId leaves the SQL and params as they were", async () => {
    const { seen, queryOne } = capture();
    await userOwnsRoom(sessionFor("u1"), "room-1", { queryOne });
    await userCan(sessionFor("u1"), "p1", { property: ["update"] }, { queryOne, testing: true });
    expect(seen[0].sql).not.toContain("::uuid");
    expect(seen[0].values).toEqual(["room-1", "u1"]);
    expect(seen[1].values).toEqual(["p1", "u1", true]);
  });

  test("a non-UUID currentPropertyId fails closed without querying or throwing", async () => {
    const { seen, queryOne } = capture();
    for (const bad of ["not-a-uuid", "", "1; DROP TABLE properties"]) {
      expect(await userOwnsProperty(sessionFor("u1"), CURRENT, { queryOne, currentPropertyId: bad })).toBe(false);
      expect(await userOwnsRoom(sessionFor("u1"), "r", { queryOne, currentPropertyId: bad })).toBe(false);
      expect(await userOwnsRatePlan(sessionFor("u1"), "rp", { queryOne, currentPropertyId: bad })).toBe(false);
      expect(await userCan(sessionFor("u1"), CURRENT, { property: ["update"] }, { queryOne, currentPropertyId: bad })).toBe(false);
    }
    expect(seen.length).toBe(0);
  });
});
