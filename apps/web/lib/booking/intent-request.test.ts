import { describe, expect, test } from "bun:test";
import { parseIntentRequest, priceChanged } from "./intent-request";

const ROOM = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const valid = {
  propertyId: "33333333-3333-4333-8333-333333333333",
  checkIn: "2031-11-10",
  checkOut: "2031-11-12",
  rooms: [{ roomId: ROOM, ratePlanId: PLAN, adults: 2, children: 1, infants: 1, cots: 1, extraBeds: 0 }],
  expectedTotalCents: 20650,
};

describe("parseIntentRequest", () => {
  test("a valid body passes through, children defaulting to 0", () => {
    expect(parseIntentRequest(valid)).toEqual({ ok: true, value: valid });
    const noChildren = { ...valid, rooms: [{ roomId: ROOM, ratePlanId: PLAN, adults: 1 }] };
    const parsed = parseIntentRequest(noChildren);
    expect(parsed.ok && parsed.value.rooms[0].children).toBe(0);
  });

  test("infants, cots and extra beds are whole numbers from 0 to 4, defaulting to 0", () => {
    const parsed = parseIntentRequest({ ...valid, rooms: [{ roomId: ROOM, ratePlanId: PLAN, adults: 1 }] });
    expect(parsed.ok && parsed.value.rooms[0]).toMatchObject({ infants: 0, cots: 0, extraBeds: 0 });
    for (const bad of [{ infants: 5 }, { infants: -1 }, { cots: 5 }, { cots: 1.5 }, { cots: -1 }, { extraBeds: 5 }, { extraBeds: "1" }]) {
      expect(parseIntentRequest({ ...valid, rooms: [{ ...valid.rooms[0], ...bad }] }).ok).toBe(false);
    }
  });

  test("1 to 9 rooms", () => {
    expect(parseIntentRequest({ ...valid, rooms: [] }).ok).toBe(false);
    expect(parseIntentRequest({ ...valid, rooms: Array(9).fill(valid.rooms[0]) }).ok).toBe(true);
    expect(parseIntentRequest({ ...valid, rooms: Array(10).fill(valid.rooms[0]) }).ok).toBe(false);
  });

  test("rejects malformed fields", () => {
    for (const bad of [
      null,
      [],
      { ...valid, propertyId: "x" },
      { ...valid, checkIn: "10-11-2031" },
      { ...valid, expectedTotalCents: "20650" },
      { ...valid, expectedTotalCents: Number.NaN },
      // Cents are whole: a euro amount is not a total in cents.
      { ...valid, expectedTotalCents: 206.5 },
      { ...valid, expectedTotalCents: -1 },
      // The euro-era key alone is no longer accepted.
      { propertyId: valid.propertyId, checkIn: valid.checkIn, checkOut: valid.checkOut, rooms: valid.rooms, expectedTotal: 206.5 },
      { ...valid, rooms: [{ ...valid.rooms[0], adults: 0 }] },
      { ...valid, rooms: [{ ...valid.rooms[0], adults: 1.5 }] },
      { ...valid, rooms: [{ ...valid.rooms[0], children: -1 }] },
      { ...valid, rooms: [{ ...valid.rooms[0], roomId: "x" }] },
    ]) {
      expect(parseIntentRequest(bad).ok).toBe(false);
    }
  });
});

describe("priceChanged", () => {
  const quote = { roomsTotalCents: 37450, touristTaxTotalCents: 1200, totalCents: 38650 };

  test("the exact total in cents books", () => {
    expect(priceChanged(38650, quote)).toBeNull();
  });

  test("one cent off either way is a price change, with the server's quote", () => {
    expect(priceChanged(38651, quote)).toEqual({ error: "price_changed", quote });
    expect(priceChanged(38649, quote)).toEqual({ error: "price_changed", quote });
  });
});
