import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const updates: unknown[] = [];
const queries: unknown[][] = [];
const queryOnes: unknown[][] = [];
let stored: { first_name: string; last_name: string } | null = null;

await mockModules(import.meta.dir, {
  "next/headers": () => ({ headers: async () => new Headers({ cookie: "x" }) }),
  "@openbookings/db": () => ({
    query: async (...args: unknown[]) => {
      queries.push(args);
      return { rows: [] };
    },
    queryOne: async (...args: unknown[]) => {
      queryOnes.push(args);
      return stored;
    },
  }),
  "@/lib/auth": () => ({
    auth: {
      api: {
        updateUser: async (arg: unknown) => {
          updates.push(arg);
        },
      },
    },
  }),
}, ["@/lib/auth"]);

const { readGuestNames, saveGuestDetails } = await import("./guest-details");

const details = { firstName: "José María", lastName: "García", phone: null, address: null };

beforeEach(() => {
  updates.length = 0;
  queries.length = 0;
  queryOnes.length = 0;
  stored = null;
});

describe("readGuestNames", () => {
  it("reads the stored names, empty when there are none", async () => {
    stored = { first_name: "Anna de", last_name: "Vries" };
    expect(await readGuestNames("u1")).toEqual({ firstName: "Anna de", lastName: "Vries" });
    stored = null;
    expect(await readGuestNames("u1")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("saveGuestDetails", () => {
  it("writes first and last name through Better Auth, never `name`", async () => {
    await saveGuestDetails("u1", details);
    expect(updates).toHaveLength(1);
    const body = (updates[0] as { body: Record<string, unknown> }).body;
    expect(body).toEqual({ firstName: "José María", lastName: "García" });
    expect("name" in body).toBe(false);
  });

  it("writes when only one of the names changed in the database", async () => {
    stored = { first_name: "José María", last_name: "Garcia" };
    await saveGuestDetails("u1", details);
    expect(updates).toHaveLength(1);
  });

  it("does not call updateUser when the stored names already match", async () => {
    stored = { first_name: "José María", last_name: "García" };
    await saveGuestDetails("u1", details);
    expect(updates).toHaveLength(0);
    expect(queries).toHaveLength(1); // the phone/address upsert still runs
  });

  it("A to B then B to A: compares with the database, so the second save is written", async () => {
    stored = { first_name: "B", last_name: "B" };
    await saveGuestDetails("u1", { ...details, firstName: "A", lastName: "A" });
    expect(updates).toHaveLength(1);
  });
});
