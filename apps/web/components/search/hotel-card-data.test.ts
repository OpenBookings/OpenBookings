import { describe, expect, test } from "bun:test";
import { formatMoney, formatRating, photoAlt, priceSummary, roomDetails } from "./hotel-card-data";

test("formatMoney", () => {
  expect(formatMoney(422, "EUR")).toBe("€422");
  expect(formatMoney(720, "CHF")).toBe("CHF\u00a0720");
  expect(formatMoney(211.6, "EUR")).toBe("€212");
  expect(() => formatMoney(10, "EU ")).not.toThrow();
  expect(formatMoney(10, "EU ")).toBe("EU  10");
});

describe("formatRating", () => {
  test("one decimal, grouped count, /5 label", () =>
    expect(formatRating(4.6, 1243)).toEqual({ value: "4.6", count: "1,243", label: "Rated 4.6 out of 5 from 1,243 reviews" }));
  test("whole numbers keep the decimal", () => expect(formatRating(4, 10)?.value).toBe("4.0"));
  test("singular review", () => expect(formatRating(5, 1)?.label).toBe("Rated 5.0 out of 5 from 1 review"));
  test("no reviews → null", () => expect(formatRating(0, 0)).toBeNull());
  test("bad rating → null", () => expect(formatRating(Number.NaN, 12)).toBeNull());
});

test("roomDetails drops empty parts", () => {
  expect(roomDetails({ type: "Deluxe Room", bed: "", size: "" })).toEqual(["Deluxe Room"]);
  expect(roomDetails({ type: "Lake View Double", bed: "King bed", size: "32 m²" })).toEqual(["Lake View Double", "King bed", "32 m²"]);
});

describe("priceSummary", () => {
  test("stay total when nights known", () =>
    expect(priceSummary({ price: 211, totalPrice: 422, nights: 2, currency: "EUR" }))
      .toEqual({ caption: null, amount: "€422", suffix: "total", detail: "2 nights · incl. taxes" }));
  test("one night", () =>
    expect(priceSummary({ price: 211, totalPrice: 211, nights: 1, currency: "EUR" }).detail).toBe("1 night · incl. taxes"));
  test("per night without dates", () =>
    expect(priceSummary({ price: 211, totalPrice: null, nights: null, currency: "EUR" }))
      .toEqual({ caption: "from", amount: "€211", suffix: "/night", detail: null }));
});

test("photoAlt", () => {
  expect(photoAlt("Hotel Lago", 0, 1)).toBe("Hotel Lago");
  expect(photoAlt("Hotel Lago", 1, 3)).toBe("Hotel Lago, photo 2 of 3");
});
