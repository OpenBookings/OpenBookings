import { describe, expect, test } from "bun:test";
import {
  allowedActions,
  buildPolicySnapshot,
  checkInClosesAt,
  calculateRefund,
  localTimeToUtc,
  nonRefundableQualifies,
  POLICY_VERSION,
  snapshotTier,
  type CancellationTier,
  type NightValue,
  type PolicySnapshot,
} from "./cancellation";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ARRIVAL = "2026-11-10";
/** 15:00 in Amsterdam on 10 Nov (CET, UTC+1). */
const CHECK_IN_AT = new Date("2026-11-10T14:00:00.000Z");
const CONFIRMED_AT = new Date("2026-10-01T10:00:00.000Z");

function nightsFrom(arrival: string, count: number, price = 100, touristTax = 3): NightValue[] {
  const start = Date.parse(`${arrival}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    price,
    touristTax,
  }));
}

/** The Annex B worked example: 5 nights at €100, €3 tourist tax per night, €515 paid. */
const FIVE_NIGHTS = nightsFrom(ARRIVAL, 5);

function snapshot(tier: CancellationTier, confirmedAt = CONFIRMED_AT): PolicySnapshot {
  return buildPolicySnapshot({
    tier,
    timeZone: "Europe/Amsterdam",
    checkInTime: "15:00",
    arrivalDate: ARRIVAL,
    confirmedAt,
  });
}

const cancelAt = (msBeforeCheckIn: number) => ({
  kind: "guest_cancellation" as const,
  at: new Date(CHECK_IN_AT.getTime() - msBeforeCheckIn),
});

describe("localTimeToUtc", () => {
  test("winter time in Amsterdam is UTC+1", () => {
    expect(localTimeToUtc("2026-11-03", "15:00", "Europe/Amsterdam").toISOString()).toBe(
      "2026-11-03T14:00:00.000Z",
    );
  });

  test("summer time in Amsterdam is UTC+2", () => {
    expect(localTimeToUtc("2026-07-01", "15:00", "Europe/Amsterdam").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
  });

  test("the afternoon of the day clocks go back is already winter time", () => {
    expect(localTimeToUtc("2026-10-25", "15:00", "Europe/Amsterdam").toISOString()).toBe(
      "2026-10-25T14:00:00.000Z",
    );
  });

  test("another zone: Lisbon summer is UTC+1", () => {
    expect(localTimeToUtc("2026-07-01", "15:00", "Europe/Lisbon").toISOString()).toBe(
      "2026-07-01T14:00:00.000Z",
    );
  });

  test("accepts HH:MM:SS as Postgres returns a time column", () => {
    expect(localTimeToUtc("2026-11-03", "15:00:00", "Europe/Amsterdam").toISOString()).toBe(
      "2026-11-03T14:00:00.000Z",
    );
  });
});

describe("snapshotTier", () => {
  test("a refundable rate follows the property tier", () => {
    expect(snapshotTier("limited", true)).toBe("limited");
  });

  test("a non-refundable rate is Non-refundable whatever the property tier", () => {
    expect(snapshotTier("flex", false)).toBe("non_refundable");
  });
});

describe("buildPolicySnapshot", () => {
  test("check-in is the property's check-in time on the arrival date", () => {
    expect(snapshot("flex").checkInAt.toISOString()).toBe(CHECK_IN_AT.toISOString());
  });

  test("records the policy version", () => {
    expect(snapshot("flex").policyVersion).toBe(POLICY_VERSION);
    expect(POLICY_VERSION).toBe("annex-b-2026-10-30");
  });

  test("Flex: full refund until 24 hours before check-in", () => {
    expect(snapshot("flex").fullRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - DAY);
    expect(snapshot("flex").partialRefundUntil).toBeNull();
  });

  test("Standard: full refund until 5 days before check-in", () => {
    expect(snapshot("standard").fullRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - 5 * DAY);
  });

  test("Limited: full refund until 14 days, 50% until 7 days before", () => {
    const s = snapshot("limited");
    expect(s.fullRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - 14 * DAY);
    expect(s.partialRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - 7 * DAY);
  });

  test("Non-refundable has no deadlines and no grace period", () => {
    const s = snapshot("non_refundable");
    expect(s.fullRefundUntil).toBeNull();
    expect(s.partialRefundUntil).toBeNull();
    expect(s.graceUntil).toBeNull();
  });

  test("grace is 24 hours after booking when check-in is far away", () => {
    expect(snapshot("flex").graceUntil?.getTime()).toBe(CONFIRMED_AT.getTime() + DAY);
  });

  test("no grace period when booked less than 7 days before check-in", () => {
    const confirmed = new Date(CHECK_IN_AT.getTime() - 3 * DAY);
    expect(snapshot("flex", confirmed).graceUntil).toBeNull();
  });

  test("grace stops 7 days before check-in when that comes first", () => {
    const confirmed = new Date(CHECK_IN_AT.getTime() - 7 * DAY - 2 * HOUR);
    expect(snapshot("flex", confirmed).graceUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - 7 * DAY);
  });
});

describe("calculateRefund — the Annex B worked examples", () => {
  const cases: [string, CancellationTier, number, number][] = [
    ["Flex, cancelled 2 days before", "flex", 2 * DAY, 515],
    ["Flex, cancelled 10 hours before", "flex", 10 * HOUR, 415],
    ["Standard, cancelled 3 days before", "standard", 3 * DAY, 215],
    ["Limited, cancelled 10 days before", "limited", 10 * DAY, 265],
    ["Limited, cancelled 3 days before", "limited", 3 * DAY, 15],
    ["Non-refundable, cancelled 60 days before", "non_refundable", 60 * DAY, 15],
  ];

  for (const [name, tier, before, refund] of cases) {
    test(`${name} → €${refund} back`, () => {
      const result = calculateRefund(snapshot(tier), FIVE_NIGHTS, cancelAt(before));
      expect(result.refund.total).toBe(refund);
      expect(result.retained.total).toBe(515 - refund);
    });
  }

  test("any tier, travel ban at the destination → everything back", () => {
    const result = calculateRefund(snapshot("non_refundable"), FIVE_NIGHTS, { kind: "travel_restriction" });
    expect(result.refund.total).toBe(515);
    expect(result.rule).toBe("full_refund_carve_out");
  });

  test("host cancellation → everything back", () => {
    const result = calculateRefund(snapshot("limited"), FIVE_NIGHTS, { kind: "host_cancellation" });
    expect(result.refund).toEqual({ accommodation: 500, touristTax: 15, total: 515 });
  });

  test("the refund splits into accommodation and tourist tax", () => {
    const result = calculateRefund(snapshot("standard"), FIVE_NIGHTS, cancelAt(3 * DAY));
    expect(result.refund).toEqual({ accommodation: 200, touristTax: 15, total: 215 });
    expect(result.retained).toEqual({ accommodation: 300, touristTax: 0, total: 300 });
    expect(result.rule).toBe("partial_refund_window");
  });

  test("nothing left to refund on the room is the no-refund window", () => {
    expect(calculateRefund(snapshot("limited"), FIVE_NIGHTS, cancelAt(3 * DAY)).rule).toBe("no_refund_window");
  });
});

describe("calculateRefund — no-shows", () => {
  for (const tier of ["flex", "standard", "limited", "non_refundable"] as const) {
    test(`${tier}: a no-show gets nothing back, tourist tax included`, () => {
      const result = calculateRefund(snapshot(tier), FIVE_NIGHTS, { kind: "no_show" });
      expect(result.refund.total).toBe(0);
      expect(result.retained.total).toBe(515);
      expect(result.rule).toBe("no_show");
    });
  }
});

describe("calculateRefund — deadlines", () => {
  test("cancelling exactly on the deadline still gets the full refund", () => {
    const s = snapshot("flex");
    const result = calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at: s.fullRefundUntil! });
    expect(result.refund.total).toBe(515);
    expect(result.rule).toBe("full_refund_window");
  });

  test("one millisecond after the deadline is the partial window", () => {
    const s = snapshot("flex");
    const at = new Date(s.fullRefundUntil!.getTime() + 1);
    expect(calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at }).refund.total).toBe(415);
  });

  test("the grace period beats the tier's window", () => {
    // Booked 10 days out on Limited: the 14-day full-refund window has passed,
    // but cancelling 2 hours after booking is inside the grace period.
    const confirmed = new Date(CHECK_IN_AT.getTime() - 10 * DAY);
    const s = snapshot("limited", confirmed);
    const at = new Date(confirmed.getTime() + 2 * HOUR);
    const result = calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at });
    expect(result.refund.total).toBe(515);
    expect(result.rule).toBe("grace_period");
  });

  test("Non-refundable has no grace period", () => {
    const confirmed = new Date(CHECK_IN_AT.getTime() - 30 * DAY);
    const s = snapshot("non_refundable", confirmed);
    const at = new Date(confirmed.getTime() + HOUR);
    expect(calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at }).refund.total).toBe(15);
  });

  test("Limited between 14 and 7 days refunds half, after 7 days nothing", () => {
    const s = snapshot("limited");
    const atSeven = { kind: "guest_cancellation" as const, at: s.partialRefundUntil! };
    expect(calculateRefund(s, FIVE_NIGHTS, atSeven).refund.accommodation).toBe(250);
    const after = { kind: "guest_cancellation" as const, at: new Date(s.partialRefundUntil!.getTime() + 1) };
    expect(calculateRefund(s, FIVE_NIGHTS, after).refund.accommodation).toBe(0);
  });
});

describe("calculateRefund — early departure", () => {
  const TEN_NIGHTS = nightsFrom(ARRIVAL, 10);
  const afterNight = (n: number) => ({ kind: "early_departure" as const, lastNightStayed: TEN_NIGHTS[n - 1].date });

  test("Limited, leaves after night 2 of 10: night 10 and the tax for nights 3–10 come back", () => {
    const result = calculateRefund(snapshot("limited"), TEN_NIGHTS, afterNight(2));
    expect(result.refund).toEqual({ accommodation: 100, touristTax: 24, total: 124 });
    expect(result.rule).toBe("early_departure");
  });

  test("Flex: the first unused night is kept, the rest refunded", () => {
    expect(calculateRefund(snapshot("flex"), TEN_NIGHTS, afterNight(2)).refund.accommodation).toBe(700);
  });

  test("Standard: the first unused night is kept, half the rest refunded", () => {
    expect(calculateRefund(snapshot("standard"), TEN_NIGHTS, afterNight(2)).refund.accommodation).toBe(350);
  });

  test("Non-refundable: no nights back, but the tourist tax for unused nights is", () => {
    expect(calculateRefund(snapshot("non_refundable"), TEN_NIGHTS, afterNight(2)).refund).toEqual({
      accommodation: 0,
      touristTax: 24,
      total: 24,
    });
  });

  test("lists the nights refunded and their share", () => {
    const result = calculateRefund(snapshot("standard"), nightsFrom(ARRIVAL, 4), {
      kind: "early_departure",
      lastNightStayed: "2026-11-10",
    });
    expect(result.nightsRefunded).toEqual([
      { date: "2026-11-11", share: 0 },
      { date: "2026-11-12", share: 0.5 },
      { date: "2026-11-13", share: 0.5 },
    ]);
  });
});

describe("calculateRefund — rounding in the guest's favour", () => {
  const nights = (prices: number[]): NightValue[] =>
    prices.map((price, i) => ({ date: `2026-11-1${i}`, price, touristTax: 0 }));

  test("an exact half stays exact", () => {
    const result = calculateRefund(snapshot("standard"), nights([33.33, 33.33, 33.33]), cancelAt(DAY));
    expect(result.refund.accommodation).toBe(33.33);
  });

  test("a half cent rounds up", () => {
    const result = calculateRefund(snapshot("standard"), nights([33.33, 33.33, 33.34]), cancelAt(DAY));
    expect(result.refund.accommodation).toBe(33.34);
    expect(result.retained.accommodation).toBe(66.66);
  });
});

describe("nonRefundableQualifies", () => {
  test("exactly 10% cheaper qualifies", () => {
    expect(nonRefundableQualifies(90, [100])).toBe(true);
  });

  test("a cent less than 10% cheaper does not", () => {
    expect(nonRefundableQualifies(90.01, [100])).toBe(false);
  });

  test("one qualifying refundable rate is enough", () => {
    expect(nonRefundableQualifies(80, [85, 100])).toBe(true);
  });

  test("no refundable rate to sit next to → does not qualify", () => {
    expect(nonRefundableQualifies(50, [])).toBe(false);
  });
});

describe("checkInClosesAt", () => {
  test("the end of the arrival window on the arrival day", () => {
    expect(
      checkInClosesAt({ arrivalDate: "2026-11-10", checkInUntil: "22:00", timeZone: "Europe/Amsterdam" }).toISOString(),
    ).toBe("2026-11-10T21:00:00.000Z");
  });

  test("midnight after the arrival day when the property has no cut-off", () => {
    expect(
      checkInClosesAt({ arrivalDate: "2026-11-10", checkInUntil: null, timeZone: "Europe/Amsterdam" }).toISOString(),
    ).toBe("2026-11-10T23:00:00.000Z");
  });
});

describe("allowedActions", () => {
  const base = {
    checkInAt: CHECK_IN_AT,
    checkInClosesAt: new Date("2026-11-10T23:00:00Z"),
    checkOutDate: "2026-11-15",
    timeZone: "Europe/Amsterdam",
  };
  const at = (iso: string) => new Date(iso);

  test("confirmed, two days before arrival: cancel or goodwill only", () => {
    expect(allowedActions({ ...base, status: "confirmed", now: at("2026-11-08T12:00:00Z") })).toEqual([
      "cancel",
      "goodwill_refund",
    ]);
  });

  test("confirmed, on the morning of arrival: can be checked in", () => {
    expect(allowedActions({ ...base, status: "confirmed", now: at("2026-11-10T09:00:00Z") })).toEqual([
      "cancel",
      "mark_checked_in",
      "goodwill_refund",
    ]);
  });

  test("confirmed, after the arrival window closed: no-show and early departure open up", () => {
    expect(allowedActions({ ...base, status: "confirmed", now: at("2026-11-11T08:00:00Z") })).toEqual([
      "cancel",
      "mark_checked_in",
      "mark_no_show",
      "record_early_departure",
      "goodwill_refund",
    ]);
  });

  test("checked in: early departure and goodwill", () => {
    expect(allowedActions({ ...base, status: "checked_in", now: at("2026-11-12T08:00:00Z") })).toEqual([
      "record_early_departure",
      "goodwill_refund",
    ]);
  });

  test("after check-out a confirmed booking can only get goodwill", () => {
    expect(allowedActions({ ...base, status: "confirmed", now: at("2026-11-16T08:00:00Z") })).toEqual([
      "mark_no_show",
      "goodwill_refund",
    ]);
  });

  test("completed: goodwill only", () => {
    expect(allowedActions({ ...base, status: "completed", now: at("2026-11-16T08:00:00Z") })).toEqual(["goodwill_refund"]);
  });

  for (const status of ["pending", "cancelled", "no_show"] as const) {
    test(`${status}: nothing`, () => {
      expect(allowedActions({ ...base, status, now: at("2026-11-08T12:00:00Z") })).toEqual([]);
    });
  }
});
