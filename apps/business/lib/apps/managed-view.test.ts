import { describe, expect, test } from "bun:test";
import { appMoment, deliveryBadge, isUnlinkedRoom } from "./managed-view";

const AMS = "Europe/Amsterdam";
// Tue 24 Nov 2026, 15:00 in Amsterdam.
const NOW = new Date("2026-11-24T14:00:00Z");

describe("appMoment", () => {
  test("today at the hotel: the time alone", () => {
    expect(appMoment("2026-11-24T13:02:00Z", AMS, NOW)).toEqual({ day: null, time: "14:02" });
  });

  test("another day at the hotel: the day too", () => {
    expect(appMoment("2026-11-20T08:15:00Z", AMS, NOW)).toEqual({ day: "20 Nov", time: "09:15" });
  });

  test("the hotel's calendar decides, not UTC's", () => {
    // 23:30 UTC on the 23rd is already the 24th in Amsterdam.
    expect(appMoment("2026-11-23T23:30:00Z", AMS, NOW)).toEqual({ day: null, time: "00:30" });
  });
});

describe("deliveryBadge", () => {
  test("delivered: mint, with SiteMinder's acknowledgement time at the hotel", () => {
    expect(deliveryBadge({ status: "delivered", acknowledgedAt: "2026-11-24T13:02:00Z" }, AMS, NOW)).toEqual({
      tone: "positive",
      label: "Sent 14:02",
      detail: "SiteMinder confirmed it at 14:02 today.",
      notDelivered: false,
    });
  });

  test("delivered on an earlier day names the day", () => {
    expect(deliveryBadge({ status: "delivered", acknowledgedAt: "2026-11-20T08:15:00Z" }, AMS, NOW)).toMatchObject({
      label: "Sent 20 Nov, 09:15",
      detail: "SiteMinder confirmed it on 20 Nov at 09:15.",
    });
  });

  test("delivered without an acknowledgement time still reads as sent", () => {
    expect(deliveryBadge({ status: "delivered", acknowledgedAt: null }, AMS, NOW)).toMatchObject({
      tone: "positive",
      label: "Sent",
    });
  });

  test("pending and retrying are neutral: nothing to do", () => {
    expect(deliveryBadge({ status: "pending", acknowledgedAt: null }, AMS, NOW)).toMatchObject({
      tone: "neutral",
      label: "Sending",
      notDelivered: false,
    });
    expect(deliveryBadge({ status: "retrying", acknowledgedAt: null }, AMS, NOW)).toMatchObject({
      tone: "neutral",
      label: "Retrying",
      notDelivered: false,
    });
  });

  test("needs attention is the one the hotel acts on", () => {
    expect(deliveryBadge({ status: "needs_attention", acknowledgedAt: null }, AMS, NOW)).toEqual({
      tone: "attention",
      label: "Not delivered",
      detail: "SiteMinder didn't accept it.",
      notDelivered: true,
    });
  });

  test("not sent: added by hand, neutral", () => {
    expect(deliveryBadge({ status: "not_sent", acknowledgedAt: null }, AMS, NOW)).toMatchObject({
      tone: "neutral",
      label: "Not sent",
      notDelivered: false,
    });
  });

  test("no delivery row or an unknown status shows nothing", () => {
    expect(deliveryBadge(null, AMS, NOW)).toBeNull();
    expect(deliveryBadge({ status: "exploded", acknowledgedAt: null }, AMS, NOW)).toBeNull();
  });
});

describe("isUnlinkedRoom", () => {
  test("only on a managed hotel, for a room SiteMinder sent nothing for", () => {
    expect(isUnlinkedRoom("r1", null)).toBe(false);
    expect(isUnlinkedRoom("r1", { unlinkedRoomIds: [] })).toBe(false);
    expect(isUnlinkedRoom("r1", { unlinkedRoomIds: ["r2"] })).toBe(false);
    expect(isUnlinkedRoom("r1", { unlinkedRoomIds: ["r1", "r2"] })).toBe(true);
  });
});
