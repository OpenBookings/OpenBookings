import { describe, expect, test } from "bun:test";
import {
  allowedActions,
  buildPolicySnapshot,
  checkInClosesAt,
  freeCancellationUntil,
  reservationPolicy,
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
    expect(snapshotTier("standard", true)).toBe("standard");
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
    expect(POLICY_VERSION).toBe("annex-b-2026-10-30-rev2");
  });

  test("Flex: free cancellation until 24 hours before check-in", () => {
    expect(snapshot("flex").fullRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - DAY);
  });

  test("Standard: free cancellation until 7 days before check-in", () => {
    expect(snapshot("standard").fullRefundUntil?.getTime()).toBe(CHECK_IN_AT.getTime() - 7 * DAY);
  });

  test("Non-refundable has no deadline", () => {
    expect(snapshot("non_refundable").fullRefundUntil).toBeNull();
  });
});

describe("calculateRefund — the Annex B worked examples", () => {
  const cases: [string, CancellationTier, number, number][] = [
    ["Flex, cancelled 2 days before", "flex", 2 * DAY, 515],
    ["Flex, cancelled 10 hours before", "flex", 10 * HOUR, 15],
    ["Standard, cancelled 10 days before", "standard", 10 * DAY, 515],
    ["Standard, cancelled 3 days before", "standard", 3 * DAY, 15],
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
    const result = calculateRefund(snapshot("standard"), FIVE_NIGHTS, { kind: "host_cancellation" });
    expect(result.refund).toEqual({ accommodation: 500, touristTax: 15, total: 515 });
  });

  test("after the deadline only the tourist tax comes back", () => {
    const result = calculateRefund(snapshot("standard"), FIVE_NIGHTS, cancelAt(3 * DAY));
    expect(result.refund).toEqual({ accommodation: 0, touristTax: 15, total: 15 });
    expect(result.retained).toEqual({ accommodation: 500, touristTax: 0, total: 500 });
    expect(result.rule).toBe("no_refund_window");
  });
});

describe("calculateRefund — no-shows", () => {
  for (const tier of ["flex", "standard", "non_refundable"] as const) {
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

  test("one millisecond after the deadline only the tourist tax comes back", () => {
    const s = snapshot("flex");
    const at = new Date(s.fullRefundUntil!.getTime() + 1);
    expect(calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at }).refund.total).toBe(15);
  });

  test("there is no grace period after booking", () => {
    // Booked 5 days out on Standard, cancelled an hour later: already past the 7-day deadline.
    const confirmed = new Date(CHECK_IN_AT.getTime() - 5 * DAY);
    const s = snapshot("standard", confirmed);
    const at = new Date(confirmed.getTime() + HOUR);
    expect(calculateRefund(s, FIVE_NIGHTS, { kind: "guest_cancellation", at }).refund.total).toBe(15);
  });
});

describe("calculateRefund — early departure (one rule for every tier)", () => {
  const TEN_NIGHTS = nightsFrom(ARRIVAL, 10);
  const afterNight = (n: number) => ({ kind: "early_departure" as const, lastNightStayed: TEN_NIGHTS[n - 1].date });

  for (const tier of ["flex", "standard", "non_refundable"] as const) {
    test(`${tier}: leaves after night 2 of 10 — night 10 and the tax for nights 3–10 come back`, () => {
      const result = calculateRefund(snapshot(tier), TEN_NIGHTS, afterNight(2));
      expect(result.refund).toEqual({ accommodation: 100, touristTax: 24, total: 124 });
      expect(result.rule).toBe("early_departure");
    });
  }

  test("seven or fewer unused nights: only their tourist tax comes back", () => {
    const result = calculateRefund(snapshot("flex"), nightsFrom(ARRIVAL, 4), {
      kind: "early_departure",
      lastNightStayed: "2026-11-10",
    });
    expect(result.refund).toEqual({ accommodation: 0, touristTax: 9, total: 9 });
    expect(result.nightsRefunded).toEqual([
      { date: "2026-11-11", share: 0 },
      { date: "2026-11-12", share: 0 },
      { date: "2026-11-13", share: 0 },
    ]);
  });
});

describe("calculateRefund — money in whole cents", () => {
  test("no float drift on odd prices", () => {
    const nights = nightsFrom(ARRIVAL, 10, 33.33, 0);
    const result = calculateRefund(snapshot("flex"), nights, { kind: "early_departure", lastNightStayed: nights[0].date });
    expect(result.refund.accommodation).toBe(66.66);
    expect(result.retained.accommodation).toBe(266.64);
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

  for (const status of ["pending"] as const) {
    test(`${status}: nothing`, () => {
      expect(allowedActions({ ...base, status, now: at("2026-11-08T12:00:00Z") })).toEqual([]);
    });
  }
});

describe("freeCancellationUntil", () => {
  const stay = { timeZone: "Europe/Amsterdam", checkInTime: "15:00", arrivalDate: ARRIVAL };

  test("booking today, a refundable rate still has its free window", () => {
    expect(
      freeCancellationUntil({ ...stay, tier: "standard", now: new Date("2026-10-01T10:00:00Z") })?.toISOString(),
    ).toBe("2026-11-03T14:00:00.000Z");
  });

  test("once the window has passed there is no free cancellation for these dates", () => {
    expect(freeCancellationUntil({ ...stay, tier: "standard", now: new Date("2026-11-05T10:00:00Z") })).toBeNull();
  });

  test("Non-refundable never has one", () => {
    expect(freeCancellationUntil({ ...stay, tier: "non_refundable", now: new Date("2026-10-01T10:00:00Z") })).toBeNull();
  });
});

describe("reservationPolicy", () => {
  const input = {
    propertyTier: "standard" as const,
    isRefundable: true,
    timeZone: "Europe/Amsterdam",
    checkInTime: "15:00:00",
    arrivalDate: ARRIVAL,
    confirmedAt: CONFIRMED_AT,
    nightPrices: nightsFrom(ARRIVAL, 3).map(({ date, price }) => ({ date, price })),
    touristTaxRules: [
      {
        effectiveFrom: "2026-01-01",
        charges: [{ kind: "fixed" as const, amount: 3, perPerson: true, perNight: true, perRoom: false }],
        childrenExempt: false,
        maxNights: null,
      },
    ],
    adults: 2,
    children: 0,
  };

  test("snapshots the property tier for a refundable rate", () => {
    const { snapshot } = reservationPolicy(input);
    expect(snapshot.tier).toBe("standard");
    expect(snapshot.checkInAt.toISOString()).toBe(CHECK_IN_AT.toISOString());
  });

  test("a non-refundable rate is snapshotted as Non-refundable", () => {
    expect(reservationPolicy({ ...input, isRefundable: false }).snapshot.tier).toBe("non_refundable");
  });

  test("each night carries its price and its tourist tax", () => {
    expect(reservationPolicy(input).nights).toEqual([
      { date: "2026-11-10", price: 100, touristTax: 6 },
      { date: "2026-11-11", price: 100, touristTax: 6 },
      { date: "2026-11-12", price: 100, touristTax: 6 },
    ]);
  });
});

describe("review fixes", () => {
  const base = {
    checkInAt: CHECK_IN_AT,
    checkInClosesAt: new Date("2026-11-10T23:00:00Z"),
    checkOutDate: "2026-11-15",
    timeZone: "Europe/Amsterdam",
  };

  test("a guest can only cancel before check-in time; a host still can later", () => {
    const afterCheckIn = new Date("2026-11-10T16:00:00Z");
    expect(allowedActions({ ...base, status: "confirmed", now: afterCheckIn, actor: "guest" })).toEqual([]);
    expect(allowedActions({ ...base, status: "confirmed", now: afterCheckIn, actor: "host" })).toContain("cancel");
    expect(allowedActions({ ...base, status: "confirmed", now: new Date("2026-11-08T12:00:00Z"), actor: "guest" })).toEqual([
      "cancel",
    ]);
  });

  test("goodwill stays possible after a cancellation or a no-show", () => {
    const later = new Date("2026-11-12T10:00:00Z");
    expect(allowedActions({ ...base, status: "cancelled", now: later })).toEqual(["goodwill_refund"]);
    expect(allowedActions({ ...base, status: "no_show", now: later })).toEqual(["goodwill_refund"]);
  });

  test("a cut-off after midnight closes the arrival window the next day", () => {
    expect(
      checkInClosesAt({ arrivalDate: "2026-11-10", checkInTime: "15:00", checkInUntil: "01:00", timeZone: "Europe/Amsterdam" }).toISOString(),
    ).toBe("2026-11-11T00:00:00.000Z");
    expect(
      checkInClosesAt({ arrivalDate: "2026-11-10", checkInTime: "15:00", checkInUntil: "22:00", timeZone: "Europe/Amsterdam" }).toISOString(),
    ).toBe("2026-11-10T21:00:00.000Z");
  });
});
