import { describe, expect, test } from "bun:test";
import { mapSearchResult, nightsBetween, type HotelSearchApiResult } from "./search-results";
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
  test("maps totals, currency, cancellation", () => {
    expect(mapSearchResult(base)).toMatchObject({
      id: "h1", slug: "hotel-lago", location: "Como, IT", price: 211, totalPrice: 422, nights: 2,
      currency: "EUR", freeCancellation: true, rating: 0, reviews: 0,
      description: { type: "Lake View Double", bed: "", size: "" }, images: ["https://x/a.jpg"],
    });
  });
  test("no nights → per-night only", () => {
    expect(mapSearchResult({ ...base, nights: [] })).toMatchObject({ price: 422, totalPrice: null, nights: null });
  });
  test("non-refundable, no image", () => {
    expect(mapSearchResult({ ...base, is_refundable: false, hero_image_url: null }))
      .toMatchObject({ freeCancellation: false, images: [] });
  });
});

describe("getDemoSearchResults", () => {
  test("totals follow nights and keep the rate currency", () => {
    const chalet = getDemoSearchResults(2).find((h) => h.name === "Chalet Matterhorn")!;
    expect(chalet.currency).toBe("CHF");
    expect(chalet.totalPrice).toBe(chalet.price * 2);
    expect(chalet.nights).toBe(2);
  });
  test("no nights → no total", () => {
    expect(getDemoSearchResults(null).every((h) => h.totalPrice === null && h.nights === null)).toBe(true);
  });
  test("cancellation follows the cheapest plan (non-refundable in every demo property)", () => {
    expect(getDemoSearchResults(null).every((h) => h.freeCancellation === false)).toBe(true);
  });
});
