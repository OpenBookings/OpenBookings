import { describe, expect, test } from "bun:test";
import { assembleFacts, FACTS_CACHE_VERSION, type MonthStore } from "./facts-cache";
import type { DateRange } from "./period";
import type { BookingFact, Facts, IsoDate } from "./types";

const HOTEL = "hotel-1";

function booking(id: string, checkIn: IsoDate, checkOut: IsoDate, createdAt: string, extra: Partial<BookingFact> = {}): BookingFact {
  return {
    id, createdAt, checkIn, checkOut, nights: 1, status: "confirmed", cancelledAt: null,
    adults: 2, children: 1, guestKey: "g-secret", guestCountry: "NL", hasGuestDetails: true,
    roomId: "r1", ratePlanId: "p1", nightlyNetCents: [100], netRevenueCents: 100,
    basePriceCents: 100, discountCents: 0, cancellationFeeCents: 0, commissionCents: 10, ...extra,
  };
}

/** What the fake live loader returns: every booking whose booked day or stay touches the window, nights clipped. */
function fakeLive(all: BookingFact[], names = { r1: "Room" }) {
  const calls: DateRange[] = [];
  const loadLive = async (_p: string, w: DateRange): Promise<Facts> => {
    calls.push(w);
    const bookings = all.filter(
      (b) => (b.createdAt.slice(0, 10) >= w.from && b.createdAt.slice(0, 10) <= w.to) || (b.checkIn <= w.to && b.checkOut > w.from),
    );
    const nights = bookings.flatMap((b) =>
      Array.from({ length: b.nights }, (_, i) => {
        const d = new Date(Date.parse(`${b.checkIn}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        return { date: d, roomId: b.roomId, ratePlanId: b.ratePlanId, bookingId: b.id, revenueCents: 100 };
      }),
    ).filter((n) => n.date >= w.from && n.date <= w.to);
    const inventory = [{ date: w.from, roomId: "r1", unitsTotal: 5, unitsOutOfOrder: 0 }];
    return { bookings, nights, inventory, roomTypeNames: names, ratePlanNames: { p1: `plan-${w.from}` } };
  };
  return { loadLive, calls };
}

function memoryStore() {
  const rows = new Map<IsoDate, { version: number; generation: number; hotel: number; facts: Facts }>();
  const gens = new Map<IsoDate, number>();
  const state = { hotel: 0 };
  const writes: IsoDate[] = [];
  const store: MonthStore = {
    async read(_p, months) {
      const out = new Map<IsoDate, Facts>();
      for (const m of months) {
        const r = rows.get(m);
        if (r && r.version === FACTS_CACHE_VERSION && r.generation === (gens.get(m) ?? 0) && r.hotel === state.hotel) out.set(m, r.facts);
      }
      return out;
    },
    async generations(_p, months) {
      return { months: new Map(months.map((m) => [m, gens.get(m) ?? 0])), hotel: state.hotel };
    },
    async write(_p, month, gen, facts) {
      if (gen.month !== (gens.get(month) ?? 0) || gen.hotel !== state.hotel) return;
      writes.push(month);
      rows.set(month, { version: FACTS_CACHE_VERSION, generation: gen.month, hotel: gen.hotel, facts });
    },
  };
  return { store, rows, gens, state, writes };
}

const TODAY = "2031-06-15";
const window = (from: IsoDate, to: IsoDate): DateRange => ({ from, to });

describe("assembleFacts", () => {
  test("finished months come from the store, current month is always live", async () => {
    const live = fakeLive([booking("a", "2031-04-10", "2031-04-11", "2031-04-01T10:00:00Z"), booking("c", "2031-06-10", "2031-06-11", "2031-06-01T10:00:00Z")]);
    const m = memoryStore();
    await assembleFacts(HOTEL, window("2031-04-01", "2031-06-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(live.calls).toHaveLength(3);
    live.calls.length = 0;
    const second = await assembleFacts(HOTEL, window("2031-04-01", "2031-06-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(live.calls).toEqual([window("2031-06-01", "2031-06-30")]);
    expect(second.bookings.map((b) => b.id).sort()).toEqual(["a", "c"]);
    expect(m.writes.sort()).toEqual(["2031-04-01", "2031-05-01"]);
  });

  test("missing month is built once and written with the generation read before loading", async () => {
    const m = memoryStore();
    m.gens.set("2031-04-01", 3);
    m.state.hotel = 7;
    const live = fakeLive([booking("a", "2031-04-10", "2031-04-11", "2031-04-01T10:00:00Z")]);
    await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(live.calls).toHaveLength(1);
    expect(m.rows.get("2031-04-01")?.generation).toBe(3);
    expect(m.rows.get("2031-04-01")?.hotel).toBe(7);
  });

  test("stale build is not served", async () => {
    const m = memoryStore();
    const live = fakeLive([booking("a", "2031-04-10", "2031-04-11", "2031-04-01T10:00:00Z")]);
    const racing = async (p: string, w: DateRange) => {
      m.gens.set("2031-04-01", 1); // a change lands while the build runs
      return live.loadLive(p, w);
    };
    const result = await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: racing });
    expect(result.bookings).toHaveLength(1); // this call still answers with what it built
    expect(m.rows.size).toBe(0);
    expect((await m.store.read(HOTEL, ["2031-04-01"])).size).toBe(0);
  });

  test("a hotel-wide change during a build blocks the write too", async () => {
    const m = memoryStore();
    const live = fakeLive([]);
    const racing = async (p: string, w: DateRange) => {
      m.state.hotel = 1;
      return live.loadLive(p, w);
    };
    await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: racing });
    expect(m.rows.size).toBe(0);
  });

  test("spanning stay counts once, live version wins", async () => {
    const m = memoryStore();
    const spanning = booking("s", "2031-05-30", "2031-06-03", "2031-05-01T10:00:00Z", { nights: 4, netRevenueCents: 400, nightlyNetCents: [100, 100, 100, 100] });
    const live = fakeLive([spanning]);
    // May is cached with an old copy of the booking; June (live) has the current one.
    m.rows.set("2031-05-01", {
      version: FACTS_CACHE_VERSION, generation: 0, hotel: 0,
      facts: { bookings: [{ ...spanning, status: "confirmed", netRevenueCents: 1 }], nights: ["2031-05-30", "2031-05-31"].map((date) => ({ date, roomId: "r1", ratePlanId: "p1", bookingId: "s", revenueCents: 100 })), inventory: [], roomTypeNames: {}, ratePlanNames: {} },
    });
    const result = await assembleFacts(HOTEL, window("2031-05-01", "2031-06-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].netRevenueCents).toBe(400);
    const keys = result.nights.map((n) => `${n.bookingId}${n.date}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result.nights.map((n) => n.date).sort()).toEqual(["2031-05-30", "2031-05-31", "2031-06-01", "2031-06-02"]);
  });

  test("result is clipped to the window", async () => {
    const m = memoryStore();
    const live = fakeLive([booking("a", "2031-04-05", "2031-04-06", "2031-04-01T10:00:00Z"), booking("b", "2031-04-25", "2031-04-26", "2031-04-20T10:00:00Z")]);
    const result = await assembleFacts(HOTEL, window("2031-04-15", "2031-04-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(result.bookings.map((b) => b.id)).toEqual(["b"]);
    expect(result.nights.map((n) => n.bookingId)).toEqual(["b"]);
    expect(result.inventory.every((i) => i.date >= "2031-04-15" && i.date <= "2031-04-30")).toBe(true);
  });

  test("facts written to the store carry no guest fields", async () => {
    const m = memoryStore();
    const live = fakeLive([booking("a", "2031-04-10", "2031-04-11", "2031-04-01T10:00:00Z")]);
    await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    const stored = m.rows.get("2031-04-01")!.facts.bookings[0];
    expect(stored).toMatchObject({ guestKey: "", guestCountry: "", adults: 0, children: 0, hasGuestDetails: false });
    expect(JSON.stringify(m.rows.get("2031-04-01"))).not.toContain("g-secret");
  });

  test("version mismatch rebuilds", async () => {
    const m = memoryStore();
    const live = fakeLive([booking("a", "2031-04-10", "2031-04-11", "2031-04-01T10:00:00Z")]);
    m.rows.set("2031-04-01", { version: FACTS_CACHE_VERSION - 1, generation: 0, hotel: 0, facts: { bookings: [], nights: [], inventory: [], roomTypeNames: {}, ratePlanNames: {} } });
    const result = await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(live.calls).toHaveLength(1);
    expect(result.bookings).toHaveLength(1);
  });

  test("names come from the live tail, and a window wholly in the past has no live call", async () => {
    const m = memoryStore();
    const live = fakeLive([], { r1: "Live room" });
    const past = await assembleFacts(HOTEL, window("2031-04-01", "2031-04-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(past.roomTypeNames).toEqual({ r1: "Live room" }); // from the last built slice when no live tail
    const mixed = await assembleFacts(HOTEL, window("2031-05-01", "2031-06-30"), TODAY, { store: m.store, loadLive: live.loadLive });
    expect(mixed.roomTypeNames).toEqual({ r1: "Live room" });
  });
});
