import { describe, expect, test } from "bun:test";
import {
  adrCents, commissionCents, earliestFactDate, expandNights, groupTypeOf, leadDays,
  median, nightsAvailable, occupancyPct, pct, ratio, revparCents, shares,
} from "./metrics";
import { booking, facts, inventory } from "./test-fixtures";

describe("ratio and pct", () => {
  test("a zero denominator is null, never Infinity or NaN", () => {
    expect(ratio(100, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
    expect(pct(1, 0)).toBeNull();
    expect(ratio(100, 4)).toBe(25);
    expect(pct(1, 4)).toBe(25);
  });
});

describe("median", () => {
  test("odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("nights and availability", () => {
  test("cancelled bookings sell no nights", () => {
    const nights = expandNights([booking(), booking({ status: "cancelled", cancelledAt: "2026-09-02T09:00:00.000Z" })]);
    expect(nights).toHaveLength(2);
    expect(nights.map((n) => n.date)).toEqual(["2026-09-10", "2026-09-11"]);
  });

  test("each night carries its own price and they sum to the booking", () => {
    const b = booking({ nights: 3, nightlyNetCents: [10_000, 12_000, 9_000] });
    const nights = expandNights([b]);
    expect(nights.map((n) => n.revenueCents)).toEqual([10_000, 12_000, 9_000]);
    expect(nights.reduce((t, n) => t + n.revenueCents, 0)).toBe(b.netRevenueCents);
  });

  test("available nights exclude out-of-order units and nothing else", () => {
    expect(nightsAvailable(inventory("2026-09-01", "2026-09-02", { standard: 10 }, 2))).toBe(16);
  });

  test("occupancy, ADR and RevPAR agree: RevPAR = ADR x occupancy", () => {
    const nights = expandNights([booking({ nights: 4 })]);
    const inv = inventory("2026-09-10", "2026-09-13", { standard: 2 });
    expect(occupancyPct(nights, inv)).toBe(50);
    expect(adrCents(nights)).toBe(10_000);
    expect(revparCents(nights, inv)).toBe(5_000);
  });

  test("ADR has no answer when nothing sold; occupancy has none when nothing was available", () => {
    expect(adrCents([])).toBeNull();
    expect(occupancyPct([], [])).toBeNull();
  });
});

describe("commission", () => {
  test("4.5%, rounded once", () => {
    expect(commissionCents(14_447_945)).toBe(650_158);
  });
});

describe("booking helpers", () => {
  test("lead time is whole days from booking date to check-in, never negative", () => {
    expect(leadDays(booking({ createdAt: "2026-09-01T23:00:00.000Z", checkIn: "2026-09-10" }))).toBe(9);
    expect(leadDays(booking({ createdAt: "2026-09-10T08:00:00.000Z", checkIn: "2026-09-10" }))).toBe(0);
    expect(leadDays(booking({ createdAt: "2026-09-12T08:00:00.000Z", checkIn: "2026-09-10" }))).toBe(0);
  });

  test("group type from the party", () => {
    expect(groupTypeOf(booking({ adults: 1 }))).toBe("solo");
    expect(groupTypeOf(booking({ adults: 2 }))).toBe("couple");
    expect(groupTypeOf(booking({ adults: 2, children: 1 }))).toBe("family");
    expect(groupTypeOf(booking({ adults: 4 }))).toBe("group");
  });

  test("the earliest fact is the first booking date, or null with no bookings", () => {
    expect(earliestFactDate(facts([]))).toBeNull();
    expect(
      earliestFactDate(facts([booking({ createdAt: "2026-03-01T10:00:00.000Z" }), booking({ createdAt: "2025-11-05T10:00:00.000Z" })])),
    ).toBe("2025-11-05");
  });
});

describe("shares", () => {
  test("ranks descending with a share of the total", () => {
    const rows = shares(new Map([["a", 25], ["b", 75]]), { a: "Alpha", b: "Beta" });
    expect(rows).toEqual([
      { key: "b", label: "Beta", value: 75, sharePct: 75 },
      { key: "a", label: "Alpha", value: 25, sharePct: 25 },
    ]);
  });

  test("keeps the top five and folds the rest into Other, last", () => {
    const groups = new Map(["a", "b", "c", "d", "e", "f", "g"].map((k, i) => [k, 70 - i * 10] as [string, number]));
    const rows = shares(groups, {});
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e", "OTHER"]);
    expect(rows.at(-1)).toMatchObject({ label: "Other", value: 30 });
    expect(rows.reduce((t, r) => t + r.value, 0)).toBe(280);
  });

  test("an empty total gives zero shares, not NaN", () => {
    expect(shares(new Map([["a", 0]]), {})[0].sharePct).toBe(0);
  });
});
