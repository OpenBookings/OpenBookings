import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, ok } from "../test-fixtures";
import { deriveGuests } from "./guests";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const from = (country: string, count: number, over = {}) =>
  Array.from({ length: count }, () => booking({ guestCountry: country, ...over }));

describe("deriveGuests", () => {
  test("a country is named only with five distinct guests behind it", () => {
    const f = facts([
      ...from("NL", 6),
      // Five bookings, one guest: naming Japan would name the guest.
      ...from("JP", 5, { guestKey: "one-regular" }),
      ...from("DE", 4),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).countries)).toEqual([
      { key: "NL", label: "Netherlands", value: 6, sharePct: 40 },
      { key: "OTHER", label: "Other", value: 9, sharePct: 60 },
    ]);
  });

  test("at most five countries are named; the rest join Other", () => {
    const f = facts(["NL", "BE", "DE", "GB", "FR", "US", "IT"].flatMap((c, i) => from(c, 12 - i)));
    const rows = ok(deriveGuests(ctx(f, SEPT)).countries);
    expect(rows.map((r) => r.key)).toEqual(["NL", "BE", "DE", "GB", "FR", "OTHER"]);
    expect(rows.at(-1)!.value).toBe(7 + 6);
    expect(rows.reduce((t, r) => t + r.value, 0)).toBe(63);
  });

  test("the page declines entirely below five distinct guests", () => {
    const f = facts(from("NL", 8, { guestKey: "one-regular" }));
    const view = deriveGuests(ctx(f, SEPT));
    expect(view.countries).toEqual({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 1 });
    expect(view.groupTypes).toMatchObject({ ok: false, reason: "below-minimum" });
  });

  test("group types are suppressed by the same rule", () => {
    const f = facts([
      ...from("NL", 6, { adults: 2 }),
      ...from("NL", 5, { adults: 1 }),
      ...from("NL", 2, { adults: 2, children: 1 }),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).groupTypes).map((r) => [r.key, r.value])).toEqual([
      ["couple", 6], ["solo", 5], ["OTHER", 2],
    ]);
  });

  test("cancelled bookings brought nobody and are counted nowhere", () => {
    const f = facts([
      ...from("NL", 6, { adults: 2 }),
      ...from("NL", 6, { adults: 4, status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    const view = deriveGuests(ctx(f, SEPT));
    expect(ok(view.countries)[0].value).toBe(6);
    expect(ok(view.medianPartySize).value).toBe(2);
    expect(view.medianPartySize).toMatchObject({ sample: 6 });
  });

  test("returning is judged against all history, not the period", () => {
    const f = facts([
      booking({ guestKey: "regular", createdAt: "2025-05-01T10:00:00.000Z", checkIn: "2025-06-01" }),
      booking({ guestKey: "regular" }),
      booking(), booking(), booking(),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).returning).value).toBe(25);
  });

  test("an empty period has no answer, not zero guests of size NaN", () => {
    const view = deriveGuests(ctx(facts([]), SEPT));
    expect(ok(view.returning).value).toBeNull();
    expect(ok(view.medianPartySize).value).toBeNull();
  });
});
