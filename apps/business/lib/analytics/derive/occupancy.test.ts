import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { deriveOccupancy } from "./occupancy";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const twoRooms = () => inventory("2025-01-01", "2026-12-31", { standard: 2 });

describe("deriveOccupancy", () => {
  test("stats are by stay date, whenever the booking was made", () => {
    const f = facts([booking({ createdAt: "2026-06-01T10:00:00.000Z", checkIn: "2026-09-10", nights: 6 })], twoRooms());
    const view = deriveOccupancy(ctx(f, SEPT));
    expect(ok(view.nightsSold).value).toBe(6);
    expect(ok(view.nightsAvailable).value).toBe(60);
    expect(ok(view.occupancy).value).toBe(10);
    expect(view.occupancy).toMatchObject({ basis: "stay", sample: 6 });
  });

  test("out-of-order units leave the denominator", () => {
    const f = facts([booking({ nights: 6 })], inventory("2026-09-01", "2026-09-30", { standard: 2 }, 1));
    expect(ok(deriveOccupancy(ctx(f, SEPT)).nightsAvailable).value).toBe(30);
  });

  test("unsold nights count the next 30 days from today, not the period", () => {
    const f = facts([booking({ checkIn: "2026-09-10", nights: 4 })], twoRooms());
    const view = deriveOccupancy(ctx(f, { from: "2026-06-01", to: "2026-06-30", today: "2026-09-01" }));
    expect(ok(view.unsoldNext30).value).toBe(56);
  });

  test("a bucket with nothing available is a gap, not zero", () => {
    const f = facts([booking({ checkIn: "2026-09-21", nights: 6 })], inventory("2026-09-15", "2026-09-30", { standard: 2 }));
    const points = ok(deriveOccupancy(ctx(f, SEPT)).overTime);
    expect(points[0].value).toBeNull();
    expect(points.at(-1)!.value).not.toBeNull();
  });

  test("the line stays weekly on long periods", () => {
    const f = facts([booking({ nights: 6 })], twoRooms());
    const view = deriveOccupancy(ctx(f, { from: "2025-10-01", to: "2026-09-30" }));
    expect(view.overTimeGranularity).toBe("week");
    expect(ok(view.overTime).length).toBeGreaterThan(50);
  });

  test("weekday bars need five nights sold", () => {
    const thin = facts([booking({ nights: 4 })], twoRooms());
    expect(deriveOccupancy(ctx(thin, SEPT)).byWeekday).toEqual({
      ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 4,
    });

    // 14 to 20 September is Monday to Sunday: one room of two sold every night.
    const full = facts([booking({ checkIn: "2026-09-14", nights: 7 })], inventory("2026-09-14", "2026-09-20", { standard: 2 }));
    const bars = ok(deriveOccupancy(ctx(full, { from: "2026-09-14", to: "2026-09-20" })).byWeekday);
    expect(bars.map((b) => b.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(bars.every((b) => b.value === 50)).toBe(true);
  });

  test("the date strip is ninety days from today with Friday and Saturday marked", () => {
    const f = facts([booking({ checkIn: "2026-09-04", nights: 1 })], twoRooms());
    const cells = ok(deriveOccupancy(ctx(f, { ...SEPT, today: "2026-09-01" })).next90);
    expect(cells).toHaveLength(90);
    expect(cells[0]).toEqual({ date: "2026-09-01", sold: 0, available: 2, weekend: false });
    expect(cells[3]).toEqual({ date: "2026-09-04", sold: 1, available: 2, weekend: true });
  });

  test("pace is absent until a year of history exists", () => {
    const f = facts([booking()], twoRooms());
    expect(deriveOccupancy(ctx(f, SEPT)).pace).toBeNull();
  });

  test("pace compares what is on the books now with the same point last year", () => {
    const f = facts(
      [
        booking({ createdAt: "2026-08-01T10:00:00.000Z", checkIn: "2026-09-03", nights: 2 }),
        // Last year's equivalent week is 2 to 8 September 2025, as of 2 September 2025.
        booking({ createdAt: "2025-08-01T10:00:00.000Z", checkIn: "2025-09-04", nights: 3 }),
        // Booked after that point: not yet on the books then.
        booking({ createdAt: "2025-09-05T10:00:00.000Z", checkIn: "2025-09-06", nights: 1 }),
        // Cancelled before that point: already off the books.
        booking({ createdAt: "2025-08-01T10:00:00.000Z", checkIn: "2025-09-03", nights: 1, status: "cancelled", cancelledAt: "2025-08-20T12:00:00.000Z" }),
        // Cancelled after that point: still on the books then.
        booking({ createdAt: "2025-08-10T10:00:00.000Z", checkIn: "2025-09-07", nights: 1, status: "cancelled", cancelledAt: "2025-09-04T12:00:00.000Z" }),
      ],
      twoRooms(),
    );
    const pace = ok(deriveOccupancy(ctx(f, { ...SEPT, today: "2026-09-01" })).pace!);
    expect(pace).toHaveLength(13);
    expect(pace[0]).toMatchObject({ bucket: "2026-09-01", value: 2, compare: 4, incomplete: false });
  });
});
