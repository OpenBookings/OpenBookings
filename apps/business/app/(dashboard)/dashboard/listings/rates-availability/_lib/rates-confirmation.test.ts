import { describe, expect, test } from "bun:test";
import { changesTouchPrice, pricedRatePlanIds } from "./rates-confirmation";

const price = { type: "price" as const, ratePlanId: "p", dates: ["2026-10-10"], price: 120 };
const clearPrice = { ...price, price: null };
const closure = { type: "closure" as const, ratePlanId: "p", dates: ["2026-10-10"] };
const restriction = { type: "restriction" as const, ratePlanId: "p", dates: ["2026-10-10"] };
const roomClosure = { type: "roomClosure" as const, roomId: "r", dates: ["2026-10-10"] };
const block = { type: "inventoryBlock" as const, roomId: "r", dates: ["2026-10-10"], blockedRooms: 1 };

describe("changesTouchPrice", () => {
  test("a draft with no price change is never held up by the confirmation", () => {
    expect(changesTouchPrice([closure, restriction, roomClosure, block])).toBe(false);
    expect(changesTouchPrice([])).toBe(false);
  });

  test("one price among many makes the whole draft a price change", () => {
    expect(changesTouchPrice([closure, block, price])).toBe(true);
  });

  test("clearing an override changes what guests pay, so it counts", () => {
    expect(changesTouchPrice([clearPrice])).toBe(true);
  });
});

describe("pricedRatePlanIds", () => {
  test("names each rate plan a draft would price, once", () => {
    const other = { ...price, ratePlanId: "q" };
    expect(pricedRatePlanIds([price, clearPrice, other, closure, block])).toEqual(["p", "q"]);
  });

  test("a rate plan that is only closed or restricted is not being priced", () => {
    expect(pricedRatePlanIds([closure, restriction, roomClosure, block])).toEqual([]);
  });
});
