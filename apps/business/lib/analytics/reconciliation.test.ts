import { describe, expect, test } from "bun:test";
import { COMMISSION_RATE } from "./derive/totals";
import { resolvePeriod, type PeriodPreset } from "./period";
import { getAnalytics } from "./get-analytics";

const TODAY = "2026-09-25";
const PRESETS: PeriodPreset[] = [
  "this-month", "last-month", "last-3-months", "ytd", "last-12-months",
];

/**
 * The acceptance criteria, asserted. Each of these is an identity that holds
 * because the figures are derived from one fact set rather than written down
 * beside each other — so if one ever fails, a derivation has started inventing.
 */
/**
 * A KPI's value is `number | null` in the view model, because ADR and friends
 * have no answer over an empty denominator. Every identity below is about a
 * figure that does have one — a null revenue beside a non-zero breakdown would
 * itself be the bug — so assert the narrowing rather than coercing past it.
 */
const notNull = (value: number | null): number => {
  expect(value).not.toBeNull();
  return value as number;
};

describe.each(PRESETS)("reconciliation over %s", (preset) => {
  const load = () =>
    getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod(preset, TODAY),
      today: TODAY,
      demo: true,
    });

  test("ADR times nights sold equals revenue", async () => {
    const data = await load();
    if (!data.revenue.adrCents.ok || !data.revenue.periodCents.ok || !data.sellThrough.roomsSold.ok) {
      throw new Error("widget failed");
    }
    const adr = data.revenue.adrCents.value.value;
    const sold = data.sellThrough.roomsSold.value;
    if (adr === null) {
      expect(sold).toBe(0);
      return;
    }
    expect(Math.round(adr * sold)).toBe(notNull(data.revenue.periodCents.value.value));
  });

  test("commission is 4.5% of revenue", async () => {
    const data = await load();
    if (!data.revenue.commissionCents.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    expect(data.revenue.commissionCents.value).toBe(
      Math.round(notNull(data.revenue.periodCents.value.value) * COMMISSION_RATE),
    );
  });

  test("revenue by room type sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.byRoomType.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(notNull(data.revenue.periodCents.value.value));
  });

  test("revenue by rate plan sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.byRatePlan.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.byRatePlan.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(notNull(data.revenue.periodCents.value.value));
  });

  test("revenue over time sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.overTime.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.overTime.value.reduce((total, point) => total + point.value, 0);
    expect(sum).toBe(notNull(data.revenue.periodCents.value.value));
  });

  test("lead-time buckets sum to the booking count", async () => {
    const data = await load();
    if (!data.bookings.leadTime.ok || !data.bookings.count.ok) throw new Error("widget failed");
    const sum = data.bookings.leadTime.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(notNull(data.bookings.count.value.value));
  });

  test("the country list accounts for every booking in the period", async () => {
    const data = await load();
    if (!data.guests.countries.ok) throw new Error("widget failed");
    const sum = data.guests.countries.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(data.bookingsInPeriod);
  });

  test("RevPAR never exceeds ADR", async () => {
    // Nights available is always at least nights sold, so revenue spread over
    // the wider denominator cannot be the larger number. If it is, one of the
    // two is dividing by the wrong thing.
    const data = await load();
    if (!data.revenue.revparCents.ok || !data.revenue.adrCents.ok) throw new Error("widget failed");
    const revpar = data.revenue.revparCents.value.value;
    const adr = data.revenue.adrCents.value.value;
    if (revpar === null || adr === null) return;
    expect(revpar).toBeLessThanOrEqual(adr + 0.0001);
  });

  test("no widget reports NaN or Infinity", async () => {
    const data = await load();
    const offenders: string[] = [];
    JSON.stringify(data, (key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) offenders.push(key);
      return value;
    });
    expect(offenders).toEqual([]);
  });
});
