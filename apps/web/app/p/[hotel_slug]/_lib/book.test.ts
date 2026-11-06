import { describe, expect, test } from "bun:test";
import type { DbRoom } from "../_components/constants";
import { bookingMessage, buildBooking, decodeSelection, encodeSelection, interpretBookResponse, nextBookStep, takePendingBook } from "./book";
import type { RoomView } from "./merge-quote";

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const FLEX = "22222222-2222-4222-8222-222222222222";
const NR = "33333333-3333-4333-8333-333333333333";

describe("selection in the URL", () => {
  test("selection round-trips through the book param", () => {
    const sel = { [FLEX]: 2, [NR]: 1 };
    const encoded = encodeSelection(sel);
    expect(encoded).toBe(`${FLEX}:2,${NR}:1`);
    expect(decodeSelection(encoded)).toEqual(sel);
  });

  test("leaves out empty picks", () => {
    expect(encodeSelection({ [FLEX]: 0, [NR]: 1 })).toBe(`${NR}:1`);
  });

  test("ignores anything malformed", () => {
    expect(decodeSelection(null)).toEqual({});
    expect(decodeSelection("")).toEqual({});
    expect(decodeSelection(`${FLEX}:x,${NR}:0,bad,:1,${FLEX}:-1,${NR}:2`)).toEqual({ [NR]: 2 });
    expect(decodeSelection(`${FLEX}:99`)).toEqual({});
  });
});

describe("takePendingBook", () => {
  test("pending book param is consumed once", () => {
    const first = takePendingBook(`${FLEX}:1`, null);
    expect(first).toEqual({ take: { [FLEX]: 1 }, consumed: `${FLEX}:1` });
    expect(takePendingBook(`${FLEX}:1`, first.consumed)).toEqual({ take: null, consumed: `${FLEX}:1` });
  });

  test("once the param is gone the same selection can be booked again later", () => {
    const gone = takePendingBook(null, `${FLEX}:1`);
    expect(gone).toEqual({ take: null, consumed: null });
    expect(takePendingBook(`${FLEX}:1`, gone.consumed).take).toEqual({ [FLEX]: 1 });
  });

  test("an empty selection is consumed without booking", () => {
    expect(takePendingBook("junk", null)).toEqual({ take: null, consumed: "junk" });
  });
});

describe("nextBookStep", () => {
  test("book without stay asks for dates", () => {
    expect(nextBookStep({ hasStay: false, pending: false })).toBe("ask_dates");
  });

  test("book is ignored while pending", () => {
    expect(nextBookStep({ hasStay: true, pending: true })).toBe("ignore");
    expect(nextBookStep({ hasStay: false, pending: true })).toBe("ignore");
  });

  test("otherwise it posts", () => {
    expect(nextBookStep({ hasStay: true, pending: false })).toBe("post");
  });
});

describe("buildBooking", () => {
  const room: DbRoom = {
    id: ROOM_A,
    name: "Classic Double",
    description: null,
    room_type: null,
    bed_type: null,
    size_sqm: null,
    max_occupancy: 2,
    images: [],
    tags: [],
    rate_plans: [
      { id: FLEX, name: "Flexible", bar: 100, currency: "EUR", is_refundable: true, meal_plan: null },
      { id: NR, name: "Non-refundable", bar: 90, currency: "EUR", is_refundable: false, meal_plan: null },
    ],
  };
  const priced = (ratePlanId: string, total: number) => ({
    ratePlanId,
    stayTotal: total,
    touristTax: 0,
    total,
    perNight: total / 3,
    freeCancellationUntil: null,
    saving: 0,
  });
  const view: RoomView = {
    roomId: ROOM_A,
    visible: true,
    unitsLeft: 5,
    leftCaption: null,
    maxAdults: 2,
    maxChildren: 1,
    rates: { [FLEX]: priced(FLEX, 300.1), [NR]: priced(NR, 270.2) },
  };

  test("splits the party over the picked rooms and adds up the total shown", () => {
    expect(buildBooking([room], [view], { [FLEX]: 1, [NR]: 1 }, { adults: 3, children: 0 })).toEqual({
      ok: true,
      rooms: [
        { roomId: ROOM_A, ratePlanId: FLEX, adults: 2, children: 0 },
        { roomId: ROOM_A, ratePlanId: NR, adults: 1, children: 0 },
      ],
      expectedTotal: 570.3,
    });
  });

  test("unpriced picks cannot be booked", () => {
    const unpriced = { ...view, rates: { [FLEX]: null }, maxAdults: null, maxChildren: null };
    expect(buildBooking([room], [unpriced], { [FLEX]: 1 }, { adults: 2, children: 0 })).toEqual({ ok: false, reason: "unpriced" });
  });

  test("says in one line why a selection cannot be booked", () => {
    const say = (sel: Record<string, number>, adults: number, children = 0) =>
      bookingMessage(buildBooking([room], [view], sel, { adults, children }), [room], [view], sel, { adults, children });
    expect(say({ [FLEX]: 1 }, 2)).toBeNull();
    expect(say({ [FLEX]: 2 }, 5)).toBe("Add a room — 2 rooms sleep up to 4");
    expect(say({ [FLEX]: 2 }, 4, 3)).toBe("Add a room — 2 rooms sleep up to 4 adults, 2 children");
    expect(say({ [FLEX]: 2 }, 1)).toBe("One room per adult at most");
    expect(say({ [FLEX]: 1 }, 3)).toBe("Classic Double sleeps 2 adults, 1 child");
  });

  test("passes on why the party does not fit", () => {
    expect(buildBooking([room], [view], { [FLEX]: 1 }, { adults: 3, children: 0 })).toEqual({
      ok: false,
      reason: "does_not_fit",
      roomId: ROOM_A,
    });
  });
});

describe("interpretBookResponse", () => {
  test("201 goes to checkout", () => {
    expect(interpretBookResponse(201, { intentId: "i", holdExpiresAt: "x", checkoutUrl: "/checkout/i" })).toEqual({
      kind: "go",
      checkoutUrl: "/checkout/i",
    });
  });

  test("a checkout url that leaves the site is an error", () => {
    expect(interpretBookResponse(201, { checkoutUrl: "https://evil.example/checkout/i" }).kind).toBe("error");
    expect(interpretBookResponse(201, { checkoutUrl: "//evil.example/checkout/i" }).kind).toBe("error");
    expect(interpretBookResponse(201, {}).kind).toBe("error");
  });

  test("401 asks to sign in", () => {
    expect(interpretBookResponse(401, { error: "auth_required" })).toEqual({ kind: "sign_in" });
  });

  test("409 price_changed carries the new total", () => {
    expect(interpretBookResponse(409, { error: "price_changed", quote: { total: 412.5, roomsTotal: 400 } })).toEqual({
      kind: "price_changed",
      total: 412.5,
    });
  });

  test("409 unavailable names the rooms when it can", () => {
    expect(interpretBookResponse(409, { error: "unavailable", roomIds: [ROOM_A] })).toEqual({
      kind: "unavailable",
      roomIds: [ROOM_A],
      message: "Sorry, that room was just booked.",
    });
    expect(interpretBookResponse(409, { error: "unavailable", detail: "Classic Double: 0 left, 1 selected" })).toEqual({
      kind: "unavailable",
      roomIds: [],
      message: "Sorry, those rooms are no longer available.",
    });
  });

  test("anything else is a plain error, never a code", () => {
    const error = { kind: "error" as const, message: "Something went wrong. Please try again." };
    expect(interpretBookResponse(400, { error: "invalid_request", errors: ["x"] })).toEqual(error);
    expect(interpretBookResponse(429, { error: "rate_limited" })).toEqual(error);
    expect(interpretBookResponse(500, { error: "server_error" })).toEqual(error);
    expect(interpretBookResponse(409, { error: "price_changed" })).toEqual(error);
    expect(interpretBookResponse(500, null)).toEqual(error);
  });
});
