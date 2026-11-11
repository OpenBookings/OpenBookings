import { describe, expect, test } from "bun:test";
import type { QuotedRatePlan, QuotedRoom, StayQuote } from "@/lib/booking/quote";
import type { DbRatePlan, DbRoom } from "../_components/constants";
import { mergeQuote, pruneQuantities, type QuoteState } from "./merge-quote";

const plan = (id: string, over: Partial<DbRatePlan> = {}): DbRatePlan => ({
  id,
  name: id,
  bar: 100,
  currency: "EUR",
  is_refundable: true,
  meal_plan: null,
  ...over,
});

const room = (id: string, plans: DbRatePlan[]): DbRoom => ({
  id,
  name: id,
  description: null,
  room_type: null,
  bed_type: null,
  size_sqm: null,
  max_occupancy: 2,
  images: [],
  rate_plans: plans,
  tags: [],
});

const quoted = (ratePlanId: string, over: Partial<QuotedRatePlan> = {}): QuotedRatePlan => ({
  ratePlanId,
  name: ratePlanId,
  isRefundable: true,
  mealPlan: null,
  nights: [],
  stayTotal: 360,
  touristTax: { total: 9, lines: [] },
  freeCancellationUntil: "2026-12-15T14:00:00.000Z",
  discount: null,
  reasons: [],
  ...over,
});

const quotedRoom = (roomId: string, ratePlans: QuotedRatePlan[], over: Partial<QuotedRoom> = {}): QuotedRoom => ({
  roomId,
  name: roomId,
  roomType: null,
  maxAdults: 2,
  maxChildren: 1,
  total: 5,
  unitsLeft: 5,
  reasons: [],
  ratePlans,
  ...over,
});

const ready = (rooms: QuotedRoom[]): QuoteState => {
  const quote: StayQuote = {
    propertyId: "p",
    slug: "s",
    currency: "EUR",
    stay: { checkIn: "2026-12-16", checkOut: "2026-12-19", adults: 2, children: 0, infants: 0, rooms: 1 },
    rooms,
  };
  return { status: "ready", quote };
};

const ROOMS = [room("a", [plan("a1"), plan("a2")]), room("b", [plan("b1")])];

describe("mergeQuote", () => {
  test("without a stay every room and rate shows, unpriced", () => {
    const views = mergeQuote(ROOMS, { status: "none" });
    expect(views).toEqual([
      { roomId: "a", visible: true, unitsLeft: null, leftCaption: null, maxAdults: null, maxChildren: null, rates: { a1: null, a2: null } },
      { roomId: "b", visible: true, unitsLeft: null, leftCaption: null, maxAdults: null, maxChildren: null, rates: { b1: null } },
    ]);
  });

  test("merge with failed quote marks unpriced", () => {
    expect(mergeQuote(ROOMS, { status: "error" })).toEqual(mergeQuote(ROOMS, { status: "none" }));
    expect(mergeQuote(ROOMS, { status: "loading" })).toEqual(mergeQuote(ROOMS, { status: "none" }));
  });

  test("totals include tourist tax; per night is the total over the nights", () => {
    const [a] = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1"), quoted("a2")]), quotedRoom("b", [quoted("b1")])]));
    expect(a.rates.a1).toEqual({
      ratePlanId: "a1",
      stayTotal: 360,
      touristTax: 9,
      total: 369,
      perNight: 123,
      freeCancellationUntil: "2026-12-15T14:00:00.000Z",
      saving: 0,
      discount: null,
    });
  });

  test("the stay discount that applied is kept for the rate row", () => {
    const discount = { label: "Weekly discount", percent: 10, amount: 40 };
    const [a] = mergeQuote([room("a", [plan("a1")])], ready([quotedRoom("a", [quoted("a1", { discount })])]));
    expect(a.rates.a1?.discount).toEqual(discount);
  });

  test("per night is rounded to cents", () => {
    const [a] = mergeQuote([room("a", [plan("a1")])], ready([quotedRoom("a", [quoted("a1", { stayTotal: 100, touristTax: { total: 0, lines: [] } })])]));
    expect(a.rates.a1?.perNight).toBe(33.33);
  });

  test("a rate with reasons is hidden", () => {
    const [a] = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1", { reasons: ["min_stay"] }), quoted("a2")])]));
    expect(a.visible).toBe(true);
    expect("a1" in a.rates).toBe(false);
    expect(a.rates.a2).not.toBeNull();
  });

  test("a room whose every rate has reasons is hidden", () => {
    const [a] = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1", { reasons: ["min_stay"] }), quoted("a2", { reasons: ["rate_closed"] })])]));
    expect(a.visible).toBe(false);
  });

  test("a room with room-level reasons is hidden", () => {
    const [a] = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1"), quoted("a2")], { reasons: ["sold_out"], unitsLeft: 0 })]));
    expect(a.visible).toBe(false);
  });

  test("rooms and rates the quote does not offer are hidden", () => {
    const [a, b] = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1")])]));
    expect(Object.keys(a.rates)).toEqual(["a1"]);
    expect(b.visible).toBe(false);
  });

  test("only the last one or two rooms are counted out loud", () => {
    const left = (unitsLeft: number) => mergeQuote([room("a", [plan("a1")])], ready([quotedRoom("a", [quoted("a1")], { unitsLeft })]))[0];
    expect(left(1)).toMatchObject({ unitsLeft: 1, leftCaption: "1 left", maxAdults: 2, maxChildren: 1 });
    expect(left(2)).toMatchObject({ unitsLeft: 2, leftCaption: "2 left" });
    expect(left(3)).toMatchObject({ unitsLeft: 3, leftCaption: null });
  });

  test("a non-refundable rate's saving is per night against the cheapest refundable rate", () => {
    const rooms = [room("a", [plan("flex"), plan("nr", { is_refundable: false })])];
    const [a] = mergeQuote(
      rooms,
      ready([
        quotedRoom("a", [
          quoted("flex", { stayTotal: 300, touristTax: { total: 0, lines: [] } }),
          quoted("nr", { isRefundable: false, stayTotal: 240, touristTax: { total: 0, lines: [] } }),
        ]),
      ]),
    );
    expect(a.rates.nr?.saving).toBe(20);
    expect(a.rates.flex?.saving).toBe(0);
  });
});

describe("pruneQuantities", () => {
  test("drops picks of hidden rates and caps picks at the rooms left", () => {
    const views = mergeQuote(
      ROOMS,
      ready([quotedRoom("a", [quoted("a1", { reasons: ["min_stay"] }), quoted("a2")], { unitsLeft: 2 }), quotedRoom("b", [quoted("b1")])]),
    );
    expect(pruneQuantities(ROOMS, views, { a1: 1, a2: 3, b1: 1 })).toEqual({ a2: 2, b1: 1 });
  });

  test("caps a room's picks across all its rates", () => {
    const views = mergeQuote(ROOMS, ready([quotedRoom("a", [quoted("a1"), quoted("a2")], { unitsLeft: 2 })]));
    expect(pruneQuantities(ROOMS, views, { a1: 2, a2: 1 })).toEqual({ a1: 2 });
  });

  test("returns the same object when nothing changes", () => {
    const views = mergeQuote(ROOMS, { status: "none" });
    const q = { a1: 1 };
    expect(pruneQuantities(ROOMS, views, q)).toBe(q);
  });
});
