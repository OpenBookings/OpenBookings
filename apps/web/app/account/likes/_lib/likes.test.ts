import { describe, expect, test } from "bun:test";
import { groupByHotel, parseView, type LikedRoomRow } from "./likes";

function row(room: string, hotel: string): LikedRoomRow {
  return {
    room_id: room,
    room_name: `Room ${room}`,
    room_image_url: null,
    property_id: hotel,
    property_name: `Hotel ${hotel}`,
    property_slug: `hotel-${hotel}`,
    city: "Utrecht",
    property_image_url: `https://cdn.openbookings.co/${hotel}.jpg`,
  };
}

describe("groupByHotel", () => {
  test("keeps the newest-first order of hotels and of rooms within each", () => {
    const hotels = groupByHotel([row("r1", "a"), row("r2", "b"), row("r3", "a")]);
    expect(hotels.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hotels[0].rooms.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(hotels[0]).toMatchObject({ name: "Hotel a", slug: "hotel-a", imageUrl: "https://cdn.openbookings.co/a.jpg" });
  });

  test("no likes, no hotels", () => {
    expect(groupByHotel([])).toEqual([]);
  });
});

describe("parseView", () => {
  test("by hotel unless by room is asked for", () => {
    expect(parseView(undefined)).toBe("hotel");
    expect(parseView("room")).toBe("room");
    expect(parseView("hotel")).toBe("hotel");
    expect(parseView(["room"])).toBe("hotel");
    expect(parseView("anything")).toBe("hotel");
  });
});
