import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

await mockModules(import.meta.dir, { "@/lib/auth": () => ({ getServerSession: async () => null }) }, ["@/lib/auth"]);

const { currentPropertyFor, pinnedAccess } = await import("./current-property");
const { activeOrgId } = await import("./active-org");

type Hotel = { property_id: string; property_name: string; organization_id: string; organization_name: string };
const hotel = (p: string, o: string): Hotel => ({ property_id: p, property_name: `Hotel ${p}`, organization_id: o, organization_name: `Org ${o}` });

/** A fake database: the hotels the user can read, the session's stored pointers, and the writes. */
function fake(hotels: Hotel[], stored: { activePropertyId: string | null; activeOrganizationId: string | null } | null, members: string[] = []) {
  const writes: unknown[][] = [];
  const query = async <T,>(text: string, values: unknown[] = []): Promise<T[]> => {
    if (text.includes("FROM properties p")) {
      return hotels.map((h) => ({ ...h, logo_url: null, role: "owner", has_property_access: false })) as T[];
    }
    if (text.includes(`FROM "member" WHERE "userId"`)) return members.map((id) => ({ id })) as T[];
    throw new Error(`unexpected query: ${text}`);
  };
  const queryOne = async <T,>(text: string, values: unknown[] = []): Promise<T | null> => {
    if (text.includes(`FROM "session"`)) return stored as T | null;
    if (text.includes(`UPDATE "session"`)) {
      writes.push(values);
      return { id: values[2] } as T;
    }
    throw new Error(`unexpected queryOne: ${text}`);
  };
  return { query, queryOne, writes };
}

const session = (active: Record<string, unknown> = {}) => ({ user: { id: "u1" }, session: { id: "s1", ...active } });

describe("currentPropertyFor", () => {
  let db: ReturnType<typeof fake>;
  beforeEach(() => {
    db = fake([hotel("p1", "orgA"), hotel("p2", "orgB")], { activePropertyId: null, activeOrganizationId: null });
  });

  it("persists a fallback pick once, then leaves a stable pick alone", async () => {
    const first = await currentPropertyFor(session(), db);
    expect(first?.propertyId).toBe("p1");
    expect(db.writes).toEqual([["p1", "orgA", "s1", "u1"]]);

    const stable = fake([hotel("p1", "orgA")], { activePropertyId: "p1", activeOrganizationId: "orgA" });
    await currentPropertyFor(session(), stable);
    expect(stable.writes).toEqual([]);
  });

  it("persists when the property matches but the org pointer is stale", async () => {
    const stale = fake([hotel("p1", "orgA")], { activePropertyId: "p1", activeOrganizationId: "orgOld" });
    await currentPropertyFor(session(), stale);
    expect(stale.writes).toEqual([["p1", "orgA", "s1", "u1"]]);
  });

  it("returns null and writes nothing when no hotel is reachable", async () => {
    const none = fake([], null);
    expect(await currentPropertyFor(session(), none)).toBeNull();
    expect(none.writes).toEqual([]);
  });
});

describe("pinnedAccess", () => {
  const CURRENT = { currentPropertyId: "11111111-1111-4111-8111-111111111111" };
  /** A fake authz check: the target is reachable, and on the current hotel only when `onCurrent`. */
  const check = (reachable: boolean, onCurrent: boolean) => {
    const pins: unknown[] = [];
    const fn = async (pin: { currentPropertyId?: string }) => {
      pins.push(pin);
      return reachable && (pin.currentPropertyId === undefined || onCurrent);
    };
    return { fn, pins };
  };

  it("passes a target on the current hotel with one check", async () => {
    const { fn, pins } = check(true, true);
    expect(await pinnedAccess(CURRENT, fn)).toBe("ok");
    expect(pins).toEqual([CURRENT]);
  });

  it("says property-switched when only the pin refused it", async () => {
    const { fn, pins } = check(true, false);
    expect(await pinnedAccess(CURRENT, fn)).toBe("property-switched");
    expect(pins).toEqual([CURRENT, {}]);
  });

  it("is a plain refusal for a target the user cannot reach at all", async () => {
    const { fn } = check(false, false);
    expect(await pinnedAccess(CURRENT, fn)).toBe("denied");
  });

  it("refuses with no current hotel, pinning the empty id authz rejects", async () => {
    const { fn, pins } = check(true, false);
    expect(await pinnedAccess({ currentPropertyId: "" }, fn)).toBe("property-switched");
    expect(pins[0]).toEqual({ currentPropertyId: "" });
  });
});
