import { describe, expect, test } from "bun:test";
import {
  comparePrice,
  coverPosition,
  formatDateRange,
  formatDistance,
  formatEuro,
  posterEyebrow,
  posterPrice,
  posterTags,
  resultsListLabel,
  type StayAvailability,
  type StayPosterData,
} from "./stay-poster-data";

const avail = (total: number, nights: number) => ({ status: "available", nights, total }) as const;

function stay(id: string, availability: StayAvailability): StayPosterData {
  return {
    id,
    name: id,
    slug: id,
    location: "Como, IT",
    distanceKm: null,
    refundable: true,
    highlights: [],
    cover: null,
    availability,
  };
}

test("formatEuro: whole euros, rounded for display only", () => {
  expect(formatEuro(422)).toBe("€422");
  expect(formatEuro(211.6)).toBe("€212");
  expect(formatEuro(1_234_567)).toBe("€1,234,567");
});

describe("formatDistance", () => {
  test("one decimal below 10 km", () => {
    expect(formatDistance(0.8)).toBe("0.8 km");
    expect(formatDistance(6.24)).toBe("6.2 km");
  });
  test("whole km from 10 up, including values that round up to 10", () => {
    expect(formatDistance(9.96)).toBe("10 km");
    expect(formatDistance(26.4)).toBe("26 km");
  });
  test("never shows 0.0", () => expect(formatDistance(0.04)).toBe("0.1 km"));
});

test("posterEyebrow", () => {
  expect(posterEyebrow({ location: "Como, IT", distanceKm: 0.8 })).toBe("Como, IT · 0.8 km from centre");
  expect(posterEyebrow({ location: "Como, IT", distanceKm: null })).toBe("Como, IT");
});

describe("posterTags", () => {
  test("cancellation first, max 2 highlights", () =>
    expect(posterTags({ refundable: true, highlights: ["Breakfast included", "Canal view", "Bikes"] })).toEqual([
      "Free cancellation",
      "Breakfast included",
      "Canal view",
    ]));
  test("non-refundable, blank highlights dropped", () =>
    expect(posterTags({ refundable: false, highlights: ["", "  "] })).toEqual(["Non-refundable"]));
});

test("formatDateRange", () => {
  expect(formatDateRange("2026-12-04", "2026-12-07")).toBe("4–7 Dec");
  expect(formatDateRange("2026-11-30", "2026-12-02")).toBe("30 Nov – 2 Dec");
});

describe("posterPrice", () => {
  test("total mode", () =>
    expect(posterPrice(avail(486, 3), "total")).toEqual({
      kind: "price",
      amount: "€486",
      unit: "total",
      detail: "3 nights · avg €162 / night",
      long: false,
      cta: "View",
    }));
  test("night mode keeps the total visible", () =>
    expect(posterPrice(avail(486, 3), "night")).toEqual({
      kind: "price",
      amount: "€162",
      unit: "avg / night",
      detail: "€486 total · 3 nights",
      long: false,
      cta: "View",
    }));
  test("avg rounds, singular night", () => {
    expect(posterPrice(avail(487, 3), "night")).toMatchObject({ amount: "€162" });
    expect(posterPrice(avail(162, 1), "total")).toMatchObject({ detail: "1 night · avg €162 / night" });
  });
  // Measured on the narrowest (260px) card: up to 7 visible characters fit at 26px.
  test("more than 7 characters → long", () => {
    expect(posterPrice(avail(99_999, 3), "total")).toMatchObject({ amount: "€99,999", long: false });
    expect(posterPrice(avail(123_456, 3), "total")).toMatchObject({ amount: "€123,456", long: true });
    expect(posterPrice(avail(1_234_567, 3), "total")).toMatchObject({ long: true });
  });
  test("unavailable with a next window", () =>
    expect(posterPrice({ status: "unavailable", nextFrom: "2026-12-04", nextTo: "2026-12-07" }, "total")).toEqual({
      kind: "notice",
      heading: "Not available",
      detail: "Next free: 4–7 Dec",
      cta: "Dates",
    }));
  test("unavailable without one", () =>
    expect(posterPrice({ status: "unavailable" }, "total")).toMatchObject({ detail: null }));
  test("no dates searched", () =>
    expect(posterPrice({ status: "undated" }, "night")).toEqual({
      kind: "notice",
      heading: "Add dates for prices",
      detail: null,
      cta: "Dates",
    }));
});

test("comparePrice puts unpriced stays last in both directions", () => {
  const a = stay("a", avail(300, 3));
  const b = stay("b", avail(200, 3));
  const u = stay("u", { status: "unavailable" });
  const d = stay("d", { status: "undated" });
  expect([u, a, d, b].sort((x, y) => comparePrice(x, y, "asc")).map((s) => s.id)).toEqual(["b", "a", "u", "d"]);
  expect([u, b, d, a].sort((x, y) => comparePrice(x, y, "desc")).map((s) => s.id)).toEqual(["a", "b", "u", "d"]);
});

test("coverPosition clamps to 0–100%", () => {
  expect(coverPosition({ focalX: 0.5, focalY: 0.4 })).toBe("50% 40%");
  expect(coverPosition({ focalX: 1.4, focalY: -0.2 })).toBe("100% 0%");
});

test("resultsListLabel", () => {
  expect(resultsListLabel(24, "Amsterdam")).toBe("24 stays in Amsterdam");
  expect(resultsListLabel(1, "Como")).toBe("1 stay in Como");
  expect(resultsListLabel(4, " ")).toBe("4 stays");
});
