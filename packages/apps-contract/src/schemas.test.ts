import { describe, expect, test } from "bun:test";
import {
  AppBookingSchema,
  AriBatchSchema,
  AriResultSchema,
  BookingChangesPageSchema,
  DeliveryReportSchema,
  InstallationRegistrationSchema,
  AppStructureSchema,
  APPS_API_VERSION,
  MAX_ARI_CHANGES,
  MAX_ARI_SPAN_DAYS,
} from "./index";

const inv = { roomCode: "DBL", from: "2031-01-01", to: "2031-01-10", unitsLeft: 3 };
const batch = (over: Record<string, unknown> = {}) => ({ inventory: [], rates: [], restrictions: [], ...over });

describe("AriBatchSchema", () => {
  test("accepts a valid batch", () => {
    expect(AriBatchSchema.safeParse(batch({ inventory: [inv] })).success).toBe(true);
  });
  test("accepts a single-day range", () => {
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, to: inv.from }] })).success).toBe(true);
  });
  test("rejects to < from", () => {
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-02-01", to: "2031-01-01" }] })).success).toBe(false);
  });
  test("rejects span over 750 days, accepts exactly 750", () => {
    expect(MAX_ARI_SPAN_DAYS).toBe(750);
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-01-01", to: "2033-02-20" }] })).success).toBe(false);
    // 2031-01-01 .. 2033-01-19 inclusive = 750 days
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-01-01", to: "2033-01-19" }] })).success).toBe(true);
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-01-01", to: "2033-01-20" }] })).success).toBe(false);
  });
  test("rejects more than 5000 changes in total", () => {
    expect(MAX_ARI_CHANGES).toBe(5000);
    expect(AriBatchSchema.safeParse(batch({ inventory: Array(5000).fill(inv) })).success).toBe(true);
    expect(AriBatchSchema.safeParse(batch({ inventory: Array(5001).fill(inv) })).success).toBe(false);
    expect(
      AriBatchSchema.safeParse(batch({ inventory: Array(2500).fill(inv), rates: Array(2501).fill({ ratePlanCode: "BAR", from: "2031-01-01", to: "2031-01-02", priceCents: 100, extraAdultCents: null, extraChildCents: null }) })).success,
    ).toBe(false);
  });
  test("rejects negative unitsLeft and non-integer cents", () => {
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, unitsLeft: -1 }] })).success).toBe(false);
    const rate = { ratePlanCode: "BAR", from: "2031-01-01", to: "2031-01-02", priceCents: 100.5, extraAdultCents: null, extraChildCents: null };
    expect(AriBatchSchema.safeParse(batch({ rates: [rate] })).success).toBe(false);
    expect(AriBatchSchema.safeParse(batch({ rates: [{ ...rate, priceCents: 18650 }] })).success).toBe(true);
  });
  test("rejects malformed and impossible dates", () => {
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-2-1" }] })).success).toBe(false);
    expect(AriBatchSchema.safeParse(batch({ inventory: [{ ...inv, from: "2031-02-30" }] })).success).toBe(false);
  });
  test("accepts a restriction carrying only closedToArrival", () => {
    const r = AriBatchSchema.safeParse(batch({ restrictions: [{ ratePlanCode: "BAR", from: "2031-01-01", to: "2031-01-02", closedToArrival: true }] }));
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data.restrictions[0]!).sort()).toEqual(["closedToArrival", "from", "ratePlanCode", "to"]);
  });
});

describe("other schemas", () => {
  test("version", () => expect(APPS_API_VERSION).toBe("v1"));
  test("AriResult union", () => {
    expect(AriResultSchema.safeParse({ ok: true, nights: 4 }).success).toBe(true);
    expect(AriResultSchema.safeParse({ ok: false, error: "x", unknownCodes: ["A"] }).success).toBe(true);
    expect(AriResultSchema.safeParse({ ok: false, error: "x" }).success).toBe(false);
  });
  test("DeliveryReport", () => {
    const ok = (r: unknown) => DeliveryReportSchema.safeParse(r).success;
    expect(ok({ status: "retrying", acknowledgedAt: null, detail: null, version: 3 })).toBe(true);
    expect(ok({ status: "delivered", acknowledgedAt: "2031-01-01T10:00:00Z", detail: null, version: 0 })).toBe(true);
    expect(ok({ status: "delivered", acknowledgedAt: "2031-01-01T10:00:00.123+01:00", detail: null, version: 7 })).toBe(true);
    expect(ok({ status: "nope", acknowledgedAt: null, detail: null, version: 1 })).toBe(false);
    // The booking version the report is about is required, a whole number, never negative.
    expect(ok({ status: "delivered", acknowledgedAt: null, detail: null })).toBe(false);
    expect(ok({ status: "delivered", acknowledgedAt: null, detail: null, version: -1 })).toBe(false);
    expect(ok({ status: "delivered", acknowledgedAt: null, detail: null, version: 1.5 })).toBe(false);
    // A malformed or zone-less timestamp is refused here (a 400), not by the database.
    for (const acknowledgedAt of ["yesterday", "2031-01-01", "2031-01-01T10:00:00", "2031-13-01T10:00:00Z"]) {
      expect(ok({ status: "delivered", acknowledgedAt, detail: null, version: 1 })).toBe(false);
    }
  });
  test("InstallationRegistration", () => {
    expect(InstallationRegistrationSchema.safeParse({ installationId: "i", propertyCode: "p", propertyName: "n", apiKey: "k", coreBaseUrl: "https://x" }).success).toBe(true);
  });
  test("AppStructure", () => {
    const s = { propertyCode: "P", propertyName: "N", timezone: "Europe/Amsterdam", rooms: [{ code: "R", name: "R", baseOccupancy: 2, maxAdults: 3, maxChildren: 1, ratePlans: [{ code: "BAR", name: "Bar", isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false }] }] };
    expect(AppStructureSchema.safeParse(s).success).toBe(true);
  });
  test("AppBooking and BookingChangesPage", () => {
    const booking = {
      bookingId: "b", reference: "OB-B7B0-2A1C", version: 1, cancelled: false, createdAt: "2031-01-01T10:00:00Z", modifiedAt: "2031-01-01T10:00:00Z",
      checkIn: "2031-05-01", checkOut: "2031-05-02", booker: { givenName: "A", surname: "B" },
      rooms: [{ reservationId: "r", roomCode: "DBL", ratePlanCode: "BAR", checkIn: "2031-05-01", checkOut: "2031-05-02", adults: 2, children: 0, infants: 0, cots: 0, extraBeds: 0, cancelled: false, nights: [{ date: "2031-05-01", priceCents: 18650 }], touristTaxCents: 300, payAtPropertyCents: 0 }],
      roomsTotalCents: 18650, touristTaxCents: 300, commissionCents: 839,
    };
    expect(AppBookingSchema.safeParse(booking).success).toBe(true);
    expect(AppBookingSchema.safeParse({ ...booking, roomsTotalCents: 1.5 }).success).toBe(false);
    expect(BookingChangesPageSchema.safeParse({ bookings: [booking], nextCursor: "c", hasMore: false }).success).toBe(true);
  });
});
