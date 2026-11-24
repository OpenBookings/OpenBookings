import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const updates: unknown[] = [];
const queries: unknown[][] = [];

await mockModules(import.meta.dir, {
  "next/headers": () => ({ headers: async () => new Headers({ cookie: "x" }) }),
  "@openbookings/db": () => ({
    query: async (...args: unknown[]) => {
      queries.push(args);
      return { rows: [] };
    },
    queryOne: async () => null,
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

const { saveGuestDetails } = await import("./guest-details");

const details = { firstName: "José María", lastName: "García", phone: null, address: null };

beforeEach(() => {
  updates.length = 0;
  queries.length = 0;
});

describe("saveGuestDetails", () => {
  it("writes first and last name through Better Auth, never `name`", async () => {
    await saveGuestDetails("u1", { firstName: "", lastName: "" }, details);
    expect(updates).toHaveLength(1);
    const body = (updates[0] as { body: Record<string, unknown> }).body;
    expect(body).toEqual({ firstName: "José María", lastName: "García" });
    expect("name" in body).toBe(false);
  });

  it("writes when only one of the names changed", async () => {
    await saveGuestDetails("u1", { firstName: "José María", lastName: "Garcia" }, details);
    expect(updates).toHaveLength(1);
  });

  it("does not call updateUser when neither name changed", async () => {
    await saveGuestDetails("u1", { firstName: "José María", lastName: "García" }, details);
    expect(updates).toHaveLength(0);
    expect(queries).toHaveLength(1); // the phone/address upsert still runs
  });
});
