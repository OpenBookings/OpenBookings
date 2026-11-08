import { describe, expect, test } from "bun:test";
import { mapSearchResult, nightsBetween, resolveCoverUrl, type HotelSearchApiResult } from "./search-results";

const base: HotelSearchApiResult = {
  hotel_id: "h1", hotel_name: "Hotel Lago", hotel_slug: "hotel-lago", city: "Como", country: "IT",
  hero_image_url: "https://x/a.jpg", room_name: "Lake View Double", room_description: "",
  currency: "EUR", is_refundable: true, free_cancellation_until: "2026-11-09T14:00:00.000Z", total_price: 422, nights: [{ date: "2026-11-10" }, { date: "2026-11-11" }],
};

describe("nightsBetween", () => {
  test("counts nights", () => expect(nightsBetween("2026-11-10", "2026-11-12")).toBe(2));
  test("empty → null", () => expect(nightsBetween("", "")).toBeNull());
  test("same day → null", () => expect(nightsBetween("2026-11-10", "2026-11-10")).toBeNull());
  test("reversed → null", () => expect(nightsBetween("2026-11-12", "2026-11-10")).toBeNull());
  test("garbage → null", () => expect(nightsBetween("soon", "later")).toBeNull());
  test("DST change still whole nights", () => expect(nightsBetween("2026-10-24", "2026-10-26")).toBe(2));
});

describe("mapSearchResult", () => {
  test("free cancellation is shown while the window for these dates is open", () =>
    expect(mapSearchResult(base).refundable).toBe(true));
  test("a refundable rate whose free window has passed is not free cancellation", () =>
    expect(mapSearchResult({ ...base, free_cancellation_until: null }).refundable).toBe(false));
  test("maps a priced result", () =>
    expect(mapSearchResult({ ...base, distance_m: 812 })).toEqual({
      id: "h1", name: "Hotel Lago", slug: "hotel-lago", location: "Como, IT", distanceKm: 0.812,
      refundable: true, highlights: [],
      cover: { url: "https://x/a.jpg", tint: null, focalX: 0.5, focalY: 0.4 },
      availability: { status: "available", nights: 2, total: 422 },
    }));
  test("no nights → undated", () =>
    expect(mapSearchResult({ ...base, nights: [] }).availability).toEqual({ status: "undated" }));
  test("no image, no distance", () =>
    expect(mapSearchResult({ ...base, hero_image_url: null })).toMatchObject({ cover: null, distanceKm: null }));
});

describe("resolveCoverUrl", () => {
  test("absolute unchanged", () => expect(resolveCoverUrl("h1", "https://x/a.jpg")).toBe("https://x/a.jpg"));
  test("protocol-relative", () => expect(resolveCoverUrl("h1", "//x/a.jpg")).toBe("https://x/a.jpg"));
  test("relative → CDN under the hotel id", () =>
    expect(resolveCoverUrl("h1", "/rooms/a.jpg")).toBe("https://cdn.openbookings.co/h1/rooms/a.jpg"));
  test("empty → null", () => expect(resolveCoverUrl("h1", "")).toBeNull());
});
