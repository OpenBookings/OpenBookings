import { describe, expect, test } from "bun:test";
import { resolvePeriod } from "./period";
import { getAnalytics, listProperties } from "./get-analytics";

const TODAY = "2026-09-25";
const thisMonth = resolvePeriod("this-month", TODAY);

describe("getAnalytics", () => {
  test("returns the same data for the same query, every time", async () => {
    const query = { propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true };
    expect(await getAnalytics(query)).toEqual(await getAnalytics(query));
  });

  test("without demo it returns an empty dataset and says the property is new", async () => {
    const data = await getAnalytics({ period: thisMonth, today: TODAY, demo: false });
    expect(data.isDemo).toBe(false);
    expect(data.hasAnyBookings).toBe(false);
    expect(data.bookingsInPeriod).toBe(0);
    // The sections are still well-formed, so a component cannot crash on them.
    expect(data.revenue.periodCents.ok).toBe(true);
    expect(data.guests.countries.ok).toBe(true);
  });

  test("a demo property with history says it has bookings", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.hasAnyBookings).toBe(true);
    expect(data.bookingsInPeriod).toBeGreaterThan(0);
  });

  test("the brand new demo property has never had a booking", async () => {
    const data = await getAnalytics({
      propertyId: "demo-nieuwehaven", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.hasAnyBookings).toBe(false);
  });

  /**
   * Review Focus 5. An empty period is not a new property. Keying the Alert off
   * "no bookings here" would tell an established host with a quiet fortnight
   * that they are waiting for their first ever booking.
   */
  test("a range before the property opened is empty but not new", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("custom", TODAY, { from: "2024-01-01", to: "2024-01-31" }),
      today: TODAY,
      demo: true,
    });
    expect(data.bookingsInPeriod).toBe(0);
    expect(data.hasAnyBookings).toBe(true);
  });

  test("an unknown property id falls back rather than throwing", async () => {
    const data = await getAnalytics({
      propertyId: "does-not-exist", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.property.id).toBe("demo-zeeburg");
  });

  test("the selected property and the full list both come back", async () => {
    const data = await getAnalytics({
      propertyId: "demo-vlierhof", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.property).toEqual({ id: "demo-vlierhof", name: "De Vlierhof" });
    expect(data.properties).toHaveLength(3);
  });

  test("fail forces exactly one widget to fail and leaves the rest standing", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true, fail: "revenue.overTime",
    });
    expect(data.revenue.overTime.ok).toBe(false);
    expect(data.revenue.periodCents.ok).toBe(true);
    expect(data.sellThrough.pct.ok).toBe(true);
  });

  test("fail is ignored outside demo mode", async () => {
    const data = await getAnalytics({
      period: thisMonth, today: TODAY, demo: false, fail: "revenue.overTime",
    });
    expect(data.revenue.overTime.ok).toBe(true);
  });

  test("the upcoming windows have facts to read beyond the period", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("last-month", TODAY),
      today: TODAY,
      demo: true,
    });
    expect(data.bookings.upcoming.ok).toBe(true);
    if (data.bookings.upcoming.ok) {
      const ninety = data.bookings.upcoming.value.find((w) => w.window === 90)!;
      expect(ninety.nightsSold + ninety.nightsAvailable).toBeGreaterThan(0);
    }
  });

  test("granularity travels with the data so charts cannot disagree", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: resolvePeriod("last-12-months", TODAY), today: TODAY, demo: true,
    });
    expect(data.granularity).toBe("month");
  });
});

describe("listProperties", () => {
  test("demo mode offers all three, so every state is reachable from the selector", () => {
    expect(listProperties(true).map((p) => p.id)).toEqual([
      "demo-zeeburg", "demo-vlierhof", "demo-nieuwehaven",
    ]);
  });

  test("outside demo mode there is nothing to list yet", () => {
    expect(listProperties(false)).toEqual([]);
  });
});
