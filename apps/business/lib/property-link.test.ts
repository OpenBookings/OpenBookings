import { describe, expect, it } from "bun:test";
import { propertyLinkRedirect } from "./property-link";

const ptr = { userId: "u1", sessionId: "s1" };

describe("propertyLinkRedirect", () => {
  it("strips ?property and keeps the rest of the query", async () => {
    const calls: unknown[][] = [];
    const setCurrentProperty = (async (...a: unknown[]) => {
      calls.push(a);
      return { propertyId: "p2" };
    }) as never;
    const out = await propertyLinkRedirect(
      new URL("http://business.localhost:3001/dashboard/rooms/r1?tab=rates&property=p2&x=1"),
      ptr,
      { setCurrentProperty },
    );
    expect(out!.pathname + out!.search).toBe("/dashboard/rooms/r1?tab=rates&x=1");
    expect(calls).toEqual([[ptr, "p2"]]);
  });

  it("ignores ?property for a hotel the user cannot read", async () => {
    const out = await propertyLinkRedirect(
      new URL("http://business.localhost:3001/dashboard/team?property=nope"),
      ptr,
      { setCurrentProperty: (async () => null) as never },
    );
    expect(out!.pathname + out!.search).toBe("/dashboard/team");
  });

  it("a prefetch does not switch", async () => {
    const never = (async () => {
      throw new Error("called");
    }) as never;
    const url = new URL("http://h/dashboard/team?property=p2");
    for (const h of <Record<string, string>[]>[{ "next-router-prefetch": "1" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }]) {
      expect(await propertyLinkRedirect(url, ptr, { setCurrentProperty: never }, new Headers(h))).toBeNull();
    }
  });

  it("does nothing outside /dashboard or without the param", async () => {
    const never = (async () => {
      throw new Error("called");
    }) as never;
    expect(await propertyLinkRedirect(new URL("http://h/account?property=p"), ptr, { setCurrentProperty: never })).toBeNull();
    expect(await propertyLinkRedirect(new URL("http://h/dashboard/x"), ptr, { setCurrentProperty: never })).toBeNull();
  });
});
