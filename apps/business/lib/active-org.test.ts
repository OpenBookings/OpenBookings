import { describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

await mockModules(import.meta.dir, { "@/lib/auth": () => ({ getServerSession: async () => null }) }, ["@/lib/auth"]);

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

describe("activeOrgId with a current hotel", () => {
  it("returns the current hotel's org for a user in two orgs", async () => {
    const db = fake([hotel("p1", "orgA"), hotel("p2", "orgB")], { activePropertyId: "p2", activeOrganizationId: "orgB" }, ["orgA", "orgB"]);
    expect(await activeOrgId(session(), { ...db, testing: false })).toBe("orgB");
  });

  it("keeps the only org for a user whose org has no property yet", async () => {
    const db = fake([], null, ["orgA"]);
    expect(await activeOrgId(session(), { ...db, testing: false })).toBe("orgA");
  });

  it("still honours the session's org when no hotel is reachable", async () => {
    const db = fake([], null, ["orgA", "orgB"]);
    expect(await activeOrgId(session({ activeOrganizationId: "orgB" }), { ...db, testing: false })).toBe("orgB");
  });
});
