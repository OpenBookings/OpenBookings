import { describe, expect, test } from "bun:test";
import { mapSearchResult, nightsBetween, resolveCoverUrl, type HotelSearchApiResult } from "./search-results";
import { getDemoSearchResults } from "./demo-data";

const base: HotelSearchApiResult = {
  hotel_id: "h1", hotel_name: "Hotel Lago", hotel_slug: "hotel-lago", city: "Como", country: "IT",
  hero_image_url: "https://x/a.jpg", room_name: "Lake View Double", room_description: "",
  currency: "EUR", is_refundable: true, total_price: 422, nights: [{ date: "2026-11-10" }, { date: "2026-11-11" }],
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
  test("maps a priced result", () =>
    expect(mapSearchResult({ ...base, distance_m: 812 })).toEqual({
      id: "h1", name: "Hotel Lago", slug: "hotel-lago", location: "Como, IT", distanceKm: 0.812,
      refundable: true, highlights: [],
      cover: { url: "https://x/a.jpg", tint: null, focalX: 0.5, focalY: 0.4 },
      availability: { status: "available", nights: 2, total: 422, currency: "EUR" },
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

describe("getDemoSearchResults", () => {
  test("totals follow nights and keep the rate currency", () =>
    // non-refundable bar: round(360 × 0.88) = 317
    expect(getDemoSearchResults(2).find((s) => s.name === "Chalet Matterhorn")!.availability).toEqual({
      status: "available", nights: 2, total: 634, currency: "CHF",
    }));
  test("Casa Roma is unavailable, dated or not", () => {
    for (const n of [2, null]) {
      expect(getDemoSearchResults(n).find((s) => s.name === "Casa Roma")!.availability.status).toBe("unavailable");
    }
  });
  test("no nights → others undated", () =>
    expect(
      getDemoSearchResults(null)
        .filter((s) => s.name !== "Casa Roma")
        .every((s) => s.availability.status === "undated"),
    ).toBe(true));
  test("every demo cover has a tint; no demo distance", () =>
    expect(getDemoSearchResults(2).every((s) => !!s.cover?.tint && s.distanceKm === null)).toBe(true));
  test("cancellation follows the cheapest plan", () =>
    expect(getDemoSearchResults(null).every((s) => s.refundable === false)).toBe(true));
});
