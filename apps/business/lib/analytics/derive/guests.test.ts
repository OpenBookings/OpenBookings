import { describe, expect, test } from "bun:test";
import type { BookingFact, Category, Facts } from "../types";
import { deriveGuests, OTHER_COUNTRY_KEY } from "./guests";

const booking = (over: Partial<BookingFact>): BookingFact => ({
  id: "b1", propertyId: "p1", createdAt: "2026-09-10T12:00:00.000Z",
  checkIn: "2026-09-20", checkOut: "2026-09-22", nights: 2,
  status: "confirmed", cancelledAt: null, adults: 2, children: 0,
  guestKey: "g1", guestCountry: "NL", netRevenueCents: 30_000,
  roomId: "standard", ratePlanId: "flex", ...over,
});

const facts = (bookings: BookingFact[]): Facts => ({
  nights: [], bookings, roomTypeNames: {}, ratePlanNames: {},
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as unknown as { value: T }).value;
};

const many = (country: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    booking({ id: `${country}-${i + from}`, guestKey: `${country}-g${i + from}`, guestCountry: country }),
  );

describe("deriveGuests", () => {
  test("average party size counts adults and children", () => {
    const section = deriveGuests(
      facts([booking({ adults: 2, children: 2 }), booking({ id: "b2", adults: 1, children: 0 })]),
      SEPT,
    );
    expect(value<number>(section.averagePartySize)).toBe(2.5);
  });

  test("a cancelled booking never stayed, so it has no party size", () => {
    const section = deriveGuests(
      facts([
        booking({ adults: 2, children: 0 }),
        booking({ id: "b2", adults: 8, children: 0, status: "cancelled", cancelledAt: "2026-09-11T00:00:00.000Z" }),
      ]),
      SEPT,
    );
    expect(value<number>(section.averagePartySize)).toBe(2);
  });

  test("party size is null with nothing to average", () => {
    expect(value<number | null>(deriveGuests(facts([]), SEPT).averagePartySize)).toBeNull();
  });

  /**
   * All history, not just the selected period. A guest's second stay is their
   * second stay whichever window the host happens to be looking at.
   */
  test("a guest whose first stay predates the period still counts as repeat", () => {
    const section = deriveGuests(
      facts([
        booking({ id: "old", guestKey: "gerda", checkIn: "2025-05-01", createdAt: "2025-04-01T12:00:00.000Z" }),
        booking({ id: "new", guestKey: "gerda", checkIn: "2026-09-20" }),
      ]),
      SEPT,
    );
    expect(value<number>(section.repeatGuestPct)).toBe(100);
  });

  test("a first-time guest is not a repeat guest", () => {
    const section = deriveGuests(facts([booking({ guestKey: "new-face" })]), SEPT);
    expect(value<number>(section.repeatGuestPct)).toBe(0);
  });

  /**
   * The privacy rule. A four-room B&B with one Japanese guest would otherwise
   * publish that guest's presence to anyone who can see the screen.
   */
  /**
   * The country list counts bookings, not stays, so a cancelled booking still
   * counts toward its country. That is deliberate, and it cuts against the
   * privacy fold at the margin: four stays plus one cancellation is five
   * bookings, and the country is named rather than folded. The spec's
   * cancelled-earns-nothing list names revenue, nights sold, length of stay and
   * party size — never country — and this widget's own definition is "bookings
   * per country", the same population section 3 counts. Pinned here so that
   * reading "bookings" as "stays" later has to argue with a test.
   */
  test("a cancelled booking still counts toward its country", () => {
    const section = deriveGuests(
      facts([
        ...many("JP", 4),
        booking({
          id: "jp-cancelled",
          guestKey: "jp-g9",
          guestCountry: "JP",
          status: "cancelled",
          cancelledAt: "2026-09-12T12:00:00.000Z",
        }),
      ]),
      SEPT,
    );
    expect(value<Category[]>(section.countries)).toEqual([
      { key: "JP", label: "Japan", value: 5 },
    ]);
  });

  test("a country with four bookings folds into Other; five stands on its own", () => {
    const section = deriveGuests(
      facts([...many("NL", 10), ...many("DE", 5), ...many("JP", 4), ...many("CA", 1)]),
      SEPT,
    );
    const rows = value<Category[]>(section.countries);
    expect(rows.map((r) => r.key)).toEqual(["NL", "DE", OTHER_COUNTRY_KEY]);
    expect(rows.find((r) => r.key === OTHER_COUNTRY_KEY)).toMatchObject({ label: "Other", value: 5 });
  });

  test("Other sorts last even when it outweighs a named country", () => {
    const section = deriveGuests(
      facts([...many("NL", 6), ...many("JP", 4), ...many("CA", 4), ...many("IE", 4)]),
      SEPT,
    );
    const rows = value<Category[]>(section.countries);
    expect(rows[rows.length - 1]).toMatchObject({ key: OTHER_COUNTRY_KEY, value: 12 });
  });

  test("no Other row appears when nothing needs folding", () => {
    const section = deriveGuests(facts([...many("NL", 6), ...many("DE", 5)]), SEPT);
    expect(value<Category[]>(section.countries).some((r) => r.key === OTHER_COUNTRY_KEY)).toBe(false);
  });

  test("countries carry a readable name", () => {
    const section = deriveGuests(facts(many("NL", 5)), SEPT);
    expect(value<Category[]>(section.countries)[0].label).toBe("Netherlands");
  });
});
