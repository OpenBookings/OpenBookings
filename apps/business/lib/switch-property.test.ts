import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

class Redirect extends Error {}
let allowed: string | null = null;
let session: unknown = { user: { id: "u1" }, session: { id: "s1" } };
const revalidated: unknown[][] = [];

await mockModules(import.meta.dir, {
  "next/cache": () => ({ revalidatePath: (...a: unknown[]) => void revalidated.push(a) }),
  "next/navigation": () => ({
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  }),
  "@openbookings/authz": () => ({
    setCurrentProperty: async (_p: unknown, id: string) => (id === allowed ? { propertyId: id } : null),
  }),
  "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => session }),
}, ["@/lib/auth"]);

const { switchProperty } = await import("./switch-property");

beforeEach(() => {
  allowed = "p2";
  session = { user: { id: "u1" }, session: { id: "s1" } };
  revalidated.length = 0;
});

describe("switchProperty", () => {
  it("refuses an unreadable property and does not redirect", async () => {
    expect(await switchProperty("other", "/dashboard/team")).toEqual({ ok: false });
    expect(revalidated).toEqual([]);
  });

  it("redirects to the section index of the page the user was on", async () => {
    const err = await switchProperty("p2", "/dashboard/bookings/reservations/abc").catch((e) => e);
    expect(err).toBeInstanceOf(Redirect);
    expect((err as Error).message).toBe("/dashboard/bookings/reservations");
    expect(revalidated).toEqual([["/dashboard", "layout"]]);
  });

  it("does not follow an off-site returnTo", async () => {
    const err = await switchProperty("p2", "https://evil.example/x").catch((e) => e);
    expect((err as Error).message).toBe("/dashboard");
  });

  it("refuses without a session", async () => {
    session = null;
    expect(await switchProperty("p2", "/dashboard")).toEqual({ ok: false });
  });
});
