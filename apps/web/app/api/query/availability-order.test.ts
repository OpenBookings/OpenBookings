import { describe, expect, test } from "bun:test";
import type { RoomAvailability } from "@openbookings/db";
import { orderByAvailability, priceCandidates } from "./availability-order";

const hotel = (id: string, bookable: boolean, reason: "sold_out" | "min_stay" | null = bookable ? null : "sold_out") => ({
  hotel_id: id,
  availability: { bookable, reason },
});

describe("orderByAvailability", () => {
  const results = [hotel("a", true), hotel("b", false, "sold_out"), hotel("c", true), hotel("d", false, "min_stay")];

  test("with testing off an unbookable hotel is dropped", () => {
    expect(orderByAvailability(results, { testing: false }).map((h) => h.hotel_id)).toEqual(["a", "c"]);
  });

  test("with testing on it comes after every bookable one, keeping its reason", () => {
    const ordered = orderByAvailability(results, { testing: true });
    expect(ordered.map((h) => h.hotel_id)).toEqual(["a", "c", "b", "d"]);
    expect(ordered[3].availability).toEqual({ bookable: false, reason: "min_stay" });
  });
});

describe("priceCandidates", () => {
  const room = (roomId: string, over: Partial<RoomAvailability> = {}): { room: RoomAvailability } => ({
    room: {
      roomId,
      onSale: true,
      maxAdults: 2,
      maxChildren: 0,
      total: 5,
      unitsLeft: 5,
      roomClosed: false,
      nights: [],
      ratePlans: [{ ratePlanId: `${roomId}-plan`, isRefundable: true, reasons: [] }],
      ...over,
    },
  });
  const row = (hotel: string, roomId: string) => ({ hotel_id: hotel, room_id: roomId, rate_plan_id: `${roomId}-plan` });
  const party = { adults: 2, children: 0 };

  test("a bookable hotel is priced only from rooms that fit and are open", () => {
    const rows = [row("h", "small"), row("h", "sold"), row("h", "closed-rate"), row("h", "ok")];
    const rooms = [
      room("small", { maxAdults: 1 }),
      room("sold", { unitsLeft: 0 }),
      room("closed-rate", { ratePlans: [{ ratePlanId: "closed-rate-plan", isRefundable: true, reasons: ["min_stay"] }] }),
      room("ok"),
    ];
    const availability = new Map([["h", { propertyId: "h", bookable: true, reason: null }]]);
    expect(priceCandidates(rows, rooms, availability, party).map((r) => r.room_id)).toEqual(["ok"]);
  });

  test("an unbookable hotel keeps every room, so it still gets a price", () => {
    const rows = [row("h", "a"), row("h", "b")];
    const rooms = [room("a", { unitsLeft: 0 }), room("b", { unitsLeft: 0 })];
    const availability = new Map([["h", { propertyId: "h", bookable: false, reason: "sold_out" as const }]]);
    expect(priceCandidates(rows, rooms, availability, party)).toHaveLength(2);
  });
});
