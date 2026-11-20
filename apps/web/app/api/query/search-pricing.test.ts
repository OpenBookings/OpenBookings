import { describe, expect, test } from "bun:test";
import type { RoomRow } from "@openbookings/pricing";
import { evenRoomParties } from "@/lib/booking/room-parties";
import { priceSearchStays } from "./search-pricing";

const row = (hotel: string, room: string, price: number, over: Partial<RoomRow> = {}): RoomRow => ({
  hotel_id: hotel,
  hotel_name: hotel,
  hotel_slug: hotel,
  city: "Amsterdam",
  country: "NL",
  hero_image_url: null,
  room_id: room,
  room_name: room,
  room_description: "",
  base_occupancy: 2,
  max_adults: 3,
  max_children: 2,
  rate_plan_id: `${room}-plan`,
  rate_plan_name: "Flexible",
  currency: "EUR",
  is_refundable: true,
  min_stay: 1,
  max_stay: null,
  nights: [
    { date: "2026-12-04", base_price: price, has_override: false },
    { date: "2026-12-05", base_price: price, has_override: false },
  ],
  modifiers: [],
  ...over,
});

const stay = { adults: 2, children: 0, infants: 0, rooms: 1, arrivalDate: "2026-12-04" };
const TODAY = "2026-11-20";

describe("evenRoomParties", () => {
  test("the first rooms take any extra, as the property page splits it", () => {
    expect(evenRoomParties({ adults: 3, children: 1, infants: 1, rooms: 2 })).toEqual([
      { adults: 2, children: 1, infants: 1 },
      { adults: 1, children: 0, infants: 0 },
    ]);
    expect(evenRoomParties({ adults: 4, children: 0, rooms: 2 })).toEqual([
      { adults: 2, children: 0, infants: 0 },
      { adults: 2, children: 0, infants: 0 },
    ]);
  });
});

describe("priceSearchStays", () => {
  test("one room: the room's all-in price", () => {
    const [r] = priceSearchStays([row("h", "double", 100)], stay, TODAY);
    expect(r.total_price).toBe(200);
    expect(r.rooms).toBe(1);
  });

  test("two rooms: the total is for both, not one room's price", () => {
    const [r] = priceSearchStays([row("h", "double", 100)], { ...stay, adults: 4, rooms: 2 }, TODAY);
    expect(r.total_price).toBe(400);
    expect(r.rooms).toBe(2);
  });

  test("an uneven party: each room is priced for its own share", () => {
    // 3 adults in 2 rooms for 2: one room has 2 adults, the other 1. Nobody is
    // above base occupancy, so no extra-adult fee, and the per-person tax is
    // charged for 3 people, not 4.
    const tax = {
      effectiveFrom: "2026-01-01",
      charges: [{ kind: "fixed" as const, amount: 3, perPerson: true, perNight: true, perRoom: false }],
      childrenExempt: false,
      maxNights: null,
    };
    const [r] = priceSearchStays(
      [row("h", "double", 100, { base_occupancy: 1, extra_adult_fee: 20, tourist_tax_rules: [tax] })],
      { ...stay, adults: 3, rooms: 2 },
      TODAY,
    );
    // Room 1: 2 nights × (100 + 20 extra adult) + 2 adults × 2 nights × 3 = 252.
    // Room 2: 2 nights × 100 + 1 adult × 2 nights × 3 = 206.
    expect(r.total_price).toBe(458);
  });

  test("the cheapest room type wins on the total, and hotels sort by it", () => {
    const results = priceSearchStays(
      [row("a", "suite", 150), row("a", "double", 120), row("b", "double", 110)],
      { ...stay, rooms: 2 },
      TODAY,
    );
    expect(results.map((r) => [r.hotel_id, r.room_id, r.total_price])).toEqual([
      ["b", "double", 440],
      ["a", "double", 480],
    ]);
  });
});
