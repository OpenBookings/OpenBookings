import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { deriveRevenue } from "./revenue";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

describe("deriveRevenue", () => {
  test("revenue is the net of kept bookings made in the period", () => {
    const f = facts([
      booking(),
      booking({ status: "cancelled", cancelledAt: "2026-09-03T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-15T10:00:00.000Z", nights: 1 }),
    ]);
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.revenue).value).toBe(20_000);
    expect(ok(view.revenue).delta).toMatchObject({ direction: "up", pct: 100 });
    expect(ok(view.commission).value).toBe(900);
    expect(ok(view.commission).delta).toBeNull();
  });

  test("no comparison means no delta anywhere", () => {
    const f = facts([booking(), booking({ createdAt: "2026-08-15T10:00:00.000Z" })]);
    const view = deriveRevenue(ctx(f, { ...SEPT, compare: "none" }));
    expect(ok(view.revenue).delta).toBeNull();
    expect(ok(view.adr).delta).toBeNull();
    expect(ok(view.yearToDate).delta).toBeNull();
    expect(ok(view.overTime).every((p) => p.compare === null)).toBe(true);
  });

  test("ADR and RevPAR are by stay date", () => {
    // Booked in August, stayed in September: no September revenue, but September nights.
    const f = facts(
      [booking({ createdAt: "2026-08-20T10:00:00.000Z", checkIn: "2026-09-10", nights: 3 })],
      inventory("2026-09-01", "2026-09-30", { standard: 1 }),
    );
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.revenue).value).toBe(0);
    expect(ok(view.adr).value).toBe(10_000);
    expect(ok(view.revpar).value).toBe(1_000);
    expect(view.adr).toMatchObject({ basis: "stay", sample: 3 });
  });

  test("year to date does not move with the period", () => {
    const f = facts([
      booking({ createdAt: "2026-02-01T10:00:00.000Z" }),
      booking({ createdAt: "2026-09-05T10:00:00.000Z" }),
    ]);
    const a = deriveRevenue(ctx(f, { ...SEPT, today: "2026-09-30" }));
    const b = deriveRevenue(ctx(f, { from: "2026-09-24", to: "2026-09-30", today: "2026-09-30" }));
    expect(ok(a.yearToDate).value).toBe(40_000);
    expect(ok(b.yearToDate).value).toBe(40_000);
  });

  test("year to date only compares when last year is fully in the history", () => {
    const recent = facts([booking({ createdAt: "2026-02-01T10:00:00.000Z" })]);
    expect(ok(deriveRevenue(ctx(recent, SEPT)).yearToDate).delta).toBeNull();

    const established = facts([
      booking({ createdAt: "2024-12-01T10:00:00.000Z" }),
      booking({ createdAt: "2025-03-01T10:00:00.000Z", nights: 1 }),
      booking({ createdAt: "2026-02-01T10:00:00.000Z" }),
    ]);
    expect(ok(deriveRevenue(ctx(established, SEPT)).yearToDate).delta).toMatchObject({ direction: "up", pct: 100 });
  });

  test("the series sums to the revenue and flags the bucket still in progress", () => {
    const f = facts([
      booking({ createdAt: "2026-07-10T10:00:00.000Z" }),
      booking({ createdAt: "2026-09-29T10:00:00.000Z", nights: 1 }),
    ]);
    const view = deriveRevenue(ctx(f, { from: "2026-07-01", to: "2026-09-30", today: "2026-09-30" }));
    const points = ok(view.overTime);
    expect(points.reduce((t, p) => t + (p.value ?? 0), 0)).toBe(ok(view.revenue).value!);
    expect(points.at(-1)!.incomplete).toBe(true);
    expect(points[0].incomplete).toBe(false);
  });

  test("both breakdowns sum to the revenue and carry shares", () => {
    const f = facts([
      booking({ roomId: "standard", ratePlanId: "flex" }),
      booking({ roomId: "suite", ratePlanId: "saver", nights: 1, nightlyNetCents: [60_000] }),
    ]);
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.byRoomType)).toEqual([
      { key: "suite", label: "Junior Suite", value: 60_000, sharePct: 75 },
      { key: "standard", label: "Standard Double", value: 20_000, sharePct: 25 },
    ]);
    expect(ok(view.byRatePlan).reduce((t, r) => t + r.value, 0)).toBe(80_000);
  });

  test("an empty period is zero revenue with a zero sample, not an error", () => {
    const view = deriveRevenue(ctx(facts([booking()]), { from: "2026-03-01", to: "2026-03-31" }));
    expect(view.revenue).toMatchObject({ ok: true, sample: 0 });
    expect(ok(view.revenue).value).toBe(0);
    expect(ok(view.adr).value).toBeNull();
    expect(view.overTime).toMatchObject({ ok: true, sample: 0 });
  });
});
