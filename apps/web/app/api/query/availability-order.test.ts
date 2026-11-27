import { describe, expect, test } from "bun:test";
import type { RoomAvailability } from "@openbookings/db";
import type { RoomRow } from "@openbookings/pricing";
import { offeredSearchRates, orderByAvailability, priceCandidates } from "./availability-order";
import { priceSearchStays } from "./search-pricing";

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

describe("offeredSearchRates", () => {
  // One night, so a rate's room price is its base rate.
  const rate = (roomId: string, planId: string, priceCents: number, isRefundable: boolean): RoomRow => ({
    hotel_id: "h",
    hotel_name: "h",
    hotel_slug: "h",
    city: "Saturnia",
    country: "IT",
    hero_image_url: null,
    room_id: roomId,
    room_name: roomId,
    room_description: "",
    base_occupancy: 2,
    max_adults: 2,
    max_children: 0,
    rate_plan_id: planId,
    rate_plan_name: planId,
    currency: "EUR",
    is_refundable: isRefundable,
    min_stay: 1,
    max_stay: null,
    nights: [{ date: "2031-12-04", base_price_cents: priceCents, has_override: false }],
    modifiers: [],
  });
  const availability = (roomId: string, plans: string[], closed: string[] = []): { room: RoomAvailability } => ({
    room: {
      roomId,
      onSale: true,
      maxAdults: 2,
      maxChildren: 0,
      total: 3,
      unitsLeft: 3,
      roomClosed: false,
      nights: [],
      ratePlans: plans.map((ratePlanId) => ({
        ratePlanId,
        isRefundable: true,
        reasons: closed.includes(ratePlanId) ? ["min_stay" as const] : [],
      })),
    },
  });
  const party = { adults: 2, children: 0, infants: 0 };
  const card = (rows: RoomRow[], rooms: { room: RoomAvailability }[]) => {
    const offered = offeredSearchRates(rows, rooms, party, "2031-12-04");
    const open = new Map([["h", { propertyId: "h", bookable: true, reason: null }]]);
    const [result] = priceSearchStays(priceCandidates(offered, rooms, open, party), {
      ...party,
      rooms: 1,
      arrivalDate: "2031-12-04",
    });
    return { offered: offered.map((r) => r.rate_plan_id), price: result.total_price_cents, plan: result.rate_plan_id };
  };

  test("a room with only Non-refundable rates prices the card from its cheapest", () => {
    const rows = [
      rate("superior", "standard", 10900, false),
      rate("superior", "plus", 12500, false),
      rate("deluxe", "flexible", 18500, true),
      rate("deluxe", "nr", 13000, false),
    ];
    const rooms = [availability("superior", ["standard", "plus"]), availability("deluxe", ["flexible", "nr"])];
    expect(card(rows, rooms)).toEqual({ offered: ["standard", "plus", "flexible", "nr"], price: 10900, plan: "standard" });
  });

  test("the card takes the cheapest offered rate, Non-refundable included", () => {
    const rows = [rate("deluxe", "flexible", 18500, true), rate("deluxe", "nr", 13000, false)];
    expect(card(rows, [availability("deluxe", ["flexible", "nr"])])).toMatchObject({ price: 13000, plan: "nr" });
  });

  test("a Non-refundable rate less than 10% under an open refundable rate never prices the card", () => {
    const rows = [rate("deluxe", "flexible", 10000, true), rate("deluxe", "nr", 9500, false)];
    expect(card(rows, [availability("deluxe", ["flexible", "nr"])])).toEqual({
      offered: ["flexible"],
      price: 10000,
      plan: "flexible",
    });
  });

  test("with the refundable rate closed for the stay, that Non-refundable rate stands on its own", () => {
    const rows = [rate("deluxe", "flexible", 10000, true), rate("deluxe", "nr", 9500, false)];
    expect(card(rows, [availability("deluxe", ["flexible", "nr"], ["flexible"])])).toMatchObject({
      price: 9500,
      plan: "nr",
    });
  });
});
