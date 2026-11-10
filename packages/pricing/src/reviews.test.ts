import { describe, expect, test } from "bun:test";
import {
  nextReplyRole,
  REPLY_THREAD_MAX,
  displayedAverage,
  hostNoShowDeadline,
  isReviewSendHour,
  reviewBand,
  projectedCheckOutAt,
  reviewEligibility,
  reviewWindow,
  stayMonth,
} from "./reviews";

const AMS = "Europe/Amsterdam";
// 12 Nov 2031, 11:00 Amsterdam (CET, UTC+1) = 10:00 UTC.
const CHECK_OUT_AT = projectedCheckOutAt({ checkOutDate: "2031-11-12", checkOutTime: "11:00:00", timeZone: AMS });
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(CHECK_OUT_AT.getTime() + ms);

const base = { status: "confirmed" as const, noShowReportedAt: null, checkOutAt: CHECK_OUT_AT, hasReview: false };

describe("projectedCheckOutAt", () => {
  test("is the property's check-out time on the check-out date, in its time zone", () => {
    expect(CHECK_OUT_AT.toISOString()).toBe("2031-11-12T10:00:00.000Z");
  });

  test("falls back to noon without a check-out time", () => {
    const t = projectedCheckOutAt({ checkOutDate: "2031-07-01", checkOutTime: null, timeZone: AMS });
    expect(t.toISOString()).toBe("2031-07-01T10:00:00.000Z"); // CEST, UTC+2
  });
});

describe("reviewEligibility", () => {
  test("opens 24 hours after check-out and closes 30 days after", () => {
    expect(reviewEligibility({ ...base, now: at(DAY - 1) })).toEqual({ ok: false, reason: "too_early" });
    expect(reviewEligibility({ ...base, now: at(DAY) }).ok).toBe(true);
    expect(reviewEligibility({ ...base, now: at(30 * DAY) }).ok).toBe(true);
    expect(reviewEligibility({ ...base, now: at(30 * DAY + 1) })).toEqual({ ok: false, reason: "window_closed" });
  });

  test("does not need the stay to be marked: confirmed, checked in and completed all count", () => {
    for (const status of ["confirmed", "checked_in", "completed"] as const) {
      expect(reviewEligibility({ ...base, status, now: at(2 * DAY) }).ok).toBe(true);
    }
  });

  test("excludes no-shows, by status or by the reported timestamp", () => {
    expect(reviewEligibility({ ...base, status: "no_show", now: at(2 * DAY) })).toEqual({ ok: false, reason: "no_show" });
    expect(reviewEligibility({ ...base, noShowReportedAt: new Date(), now: at(2 * DAY) })).toEqual({ ok: false, reason: "no_show" });
  });

  test("excludes bookings that were never stayed", () => {
    expect(reviewEligibility({ ...base, status: "cancelled", now: at(2 * DAY) })).toEqual({ ok: false, reason: "not_stayed" });
    expect(reviewEligibility({ ...base, status: "pending", now: at(2 * DAY) })).toEqual({ ok: false, reason: "not_stayed" });
  });

  test("allows one review per booking", () => {
    expect(reviewEligibility({ ...base, hasReview: true, now: at(2 * DAY) })).toEqual({ ok: false, reason: "already_reviewed" });
  });

  test("returns when the window closes", () => {
    const result = reviewEligibility({ ...base, now: at(2 * DAY) });
    expect(result).toEqual({ ok: true, closesAt: reviewWindow(CHECK_OUT_AT).closesAt });
  });
});

describe("hostNoShowDeadline", () => {
  test("is the moment the review opens", () => {
    const deadline = hostNoShowDeadline({ checkOutDate: "2031-11-12", checkOutTime: "11:00", timeZone: AMS });
    expect(deadline.toISOString()).toBe("2031-11-13T10:00:00.000Z");
  });
});

describe("isReviewSendHour", () => {
  test("is daytime on the property's clock", () => {
    expect(isReviewSendHour(new Date("2031-11-13T07:59:00Z"), AMS)).toBe(false); // 08:59
    expect(isReviewSendHour(new Date("2031-11-13T08:00:00Z"), AMS)).toBe(true); // 09:00
    expect(isReviewSendHour(new Date("2031-11-13T18:59:00Z"), AMS)).toBe(true); // 19:59
    expect(isReviewSendHour(new Date("2031-11-13T19:00:00Z"), AMS)).toBe(false); // 20:00
  });
});

describe("display helpers", () => {
  test("stayMonth keeps only the month", () => {
    expect(stayMonth("2031-11-12")).toBe("2031-11-01");
  });

  test("the average needs three reviews and has one decimal", () => {
    expect(displayedAverage([9, 10])).toBeNull();
    expect(displayedAverage([9, 10, 8])).toBe(9);
    expect(displayedAverage([9, 10, 8, 7])).toBe(8.5);
    expect(displayedAverage([10, 9, 9])).toBe(9.3);
  });
});

describe("reviewBand", () => {
  test("maps scores and averages to words", () => {
    expect(reviewBand(10).label).toBe("Terrific");
    expect(reviewBand(9).label).toBe("Terrific");
    expect(reviewBand(8.9).label).toBe("Great");
    expect(reviewBand(7).label).toBe("Good");
    expect(reviewBand(6).label).toBe("Okay");
    expect(reviewBand(5).label).toBe("Okay");
    expect(reviewBand(4.9).label).toBe("Bad");
    expect(reviewBand(1).id).toBe("bad");
  });
});

describe("nextReplyRole", () => {
  test("nextReplyRole follows host, guest, host and then closes", () => {
    expect(nextReplyRole([])).toBe("host");
    expect(nextReplyRole(["host"])).toBe("guest");
    expect(nextReplyRole(["host", "guest"])).toBe("host");
    expect(nextReplyRole(["host", "guest", "host"])).toBeNull();
    expect(REPLY_THREAD_MAX).toBe(3);
  });
});
