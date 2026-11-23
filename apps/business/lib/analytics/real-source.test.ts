import { describe, expect, test } from "bun:test";
import { realFactsSource } from "./real-source";
import type { Facts } from "./types";

const facts: Facts = { bookings: [], inventory: [], nights: [], roomTypeNames: {}, ratePlanNames: {} };
const window = { from: "2026-01-01", to: "2026-12-31" };

function deps() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      loadFacts: async (id: string) => { calls.push(`facts:${id}`); return facts; },
      loadHotelSpan: async () => ({ earliest: "2024-05-01", hasAnyBookings: true }),
      loadGuestDetails: async () => { calls.push("details"); return []; },
      attachGuestDetails: (f: Facts) => { calls.push("attach"); return { ...f, roomTypeNames: { attached: "yes" } }; },
    },
  };
}

describe("realFactsSource", () => {
  test("guest details are attached only on the guests page", async () => {
    const g = deps();
    const guests = await realFactsSource("p1", g.deps)("guests", window, "2026-10-01");
    expect(g.calls).toContain("details");
    expect(guests.facts.roomTypeNames).toEqual({ attached: "yes" });
    expect(guests.guestWindowStart).not.toBeNull();
    expect(guests).toMatchObject({ earliest: "2024-05-01", hasAnyBookings: true });

    const r = deps();
    const rev = await realFactsSource("p1", r.deps)("revenue", window, "2026-10-01");
    expect(r.calls).toEqual(["facts:p1"]);
    expect(rev.guestWindowStart).toBeNull();
    expect(rev.facts).toBe(facts);
  });
});
