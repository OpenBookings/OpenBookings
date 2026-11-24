import { describe, expect, test } from "bun:test";
import type { AppBooking } from "@openbookings/apps-contract";
import { afterResult, nextMessage, RETRY_WINDOW_SECONDS, type OutboxRow } from "./outbox";
import { RETRY_SECONDS } from "./retry";

const booking = (version: number, over: Partial<AppBooking> = {}, roomCancelled = false): AppBooking => ({
  bookingId: "b1", reference: "OB-B7B0-2A1C", version, cancelled: false, createdAt: "2031-01-01T10:00:00Z", modifiedAt: "2031-01-01T10:00:00Z",
  checkIn: "2031-05-01", checkOut: "2031-05-02", booker: { givenName: "A", surname: "B" },
  rooms: [{ reservationId: "r1", roomCode: "DBL", ratePlanCode: "BAR", checkIn: "2031-05-01", checkOut: "2031-05-02", adults: 2, children: 0, infants: 0, cots: 0, extraBeds: 0, cancelled: roomCancelled, nights: [{ date: "2031-05-01", priceCents: 18650 }], touristTaxCents: 300, payAtPropertyCents: 0 }],
  roomsTotalCents: 18650, touristTaxCents: 300, commissionCents: 839, ...over,
});
const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  acked: "none", ackedVersion: null, latest: booking(1), latestVersion: 1, status: "waiting", attempts: 0, commitAttemptVersion: null, ...over,
});
const fail = (permanent = false) => ({ ok: false as const, permanent, error: "boom" });

describe("nextMessage", () => {
  test("not_sent -> none", () => {
    expect(nextMessage(row({ status: "not_sent" }))).toEqual({ send: "none" });
  });
  test("never acknowledged -> Commit with the latest booking", () => {
    const r = row({ latest: booking(3), latestVersion: 3 });
    expect(nextMessage(r)).toEqual({ send: "Commit", booking: r.latest });
  });
  test("never acknowledged and already cancelled -> still Commit first", () => {
    expect(nextMessage(row({ latest: booking(2, { cancelled: true }), latestVersion: 2 }))).toMatchObject({ send: "Commit" });
  });
  test("committed + newer version -> Modify with the latest booking", () => {
    const r = row({ acked: "committed", ackedVersion: 1, latest: booking(4), latestVersion: 4 });
    expect(nextMessage(r)).toEqual({ send: "Modify", booking: r.latest });
  });
  test("committed + same version -> none", () => {
    expect(nextMessage(row({ acked: "committed", ackedVersion: 2, latest: booking(2), latestVersion: 2 }))).toEqual({ send: "none" });
  });
  test("committed with unknown acked version -> Modify", () => {
    expect(nextMessage(row({ acked: "committed", ackedVersion: null }))).toMatchObject({ send: "Modify" });
  });
  test("committed + latest cancelled -> Cancel, not Modify", () => {
    const r = row({ acked: "committed", ackedVersion: 1, latest: booking(2, { cancelled: true }), latestVersion: 2 });
    expect(nextMessage(r)).toEqual({ send: "Cancel", booking: r.latest });
  });
  test("every room cancelled but cancelled=false -> Cancel", () => {
    const r = row({ acked: "committed", ackedVersion: 1, latest: booking(2, {}, true), latestVersion: 2 });
    expect(nextMessage(r)).toMatchObject({ send: "Cancel" });
  });
  test("committed at the cancelled version (Commit of a cancelled booking acked) -> Cancel", () => {
    const r = row({ acked: "committed", ackedVersion: 2, latest: booking(2, { cancelled: true }), latestVersion: 2 });
    expect(nextMessage(r)).toMatchObject({ send: "Cancel" });
  });
  test("some rooms cancelled -> Modify", () => {
    const b = booking(2);
    b.rooms = [{ ...b.rooms[0]!, cancelled: true }, { ...b.rooms[0]!, reservationId: "r2" }];
    expect(nextMessage(row({ acked: "committed", ackedVersion: 1, latest: b, latestVersion: 2 }))).toMatchObject({ send: "Modify" });
  });
  test("cancelled + latest cancelled (even newer) -> none", () => {
    expect(nextMessage(row({ acked: "cancelled", ackedVersion: 2, latest: booking(3, { cancelled: true }), latestVersion: 3 }))).toEqual({ send: "none" });
  });
  test("cancelled + reopened -> needs attention, never Commit", () => {
    expect(nextMessage(row({ acked: "cancelled", ackedVersion: 2, latest: booking(3), latestVersion: 3 }))).toEqual({
      needsAttention: "reopened after cancellation — tell the hotel",
    });
  });
  test("a needs_attention row still computes what would be sent", () => {
    expect(nextMessage(row({ status: "needs_attention", attempts: 5 }))).toMatchObject({ send: "Commit" });
  });
});

describe("afterResult", () => {
  test("success resets attempts and delivers when nothing newer is pending", () => {
    const out = afterResult(row({ attempts: 3, status: "sending" }), "Commit", { ok: true }, 1, 0);
    expect(out).toEqual({ acked: "committed", ackedVersion: 1, attempts: 0, status: "delivered", retryInSeconds: null, commitAttemptVersion: null });
  });
  test("Modify and Cancel success", () => {
    const m = row({ acked: "committed", ackedVersion: 1, latest: booking(2), latestVersion: 2 });
    expect(afterResult(m, "Modify", { ok: true }, 2, 0)).toMatchObject({ acked: "committed", ackedVersion: 2, status: "delivered" });
    const c = row({ acked: "committed", ackedVersion: 1, latest: booking(2, { cancelled: true }), latestVersion: 2 });
    expect(afterResult(c, "Cancel", { ok: true }, 2, 0)).toMatchObject({ acked: "cancelled", ackedVersion: 2, status: "delivered" });
  });
  test("sent an older version than latest -> waiting, acked at the sent version", () => {
    const fresh = row({ latest: booking(4), latestVersion: 4, status: "sending" });
    expect(afterResult(fresh, "Commit", { ok: true }, 2, 0)).toEqual({ acked: "committed", ackedVersion: 2, attempts: 0, status: "waiting", retryInSeconds: null, commitAttemptVersion: null });
  });
  test("Modify of v2 succeeds while v4 is the latest -> acked at 2, waiting (v4 still to send)", () => {
    const fresh = row({ acked: "committed", ackedVersion: 1, latest: booking(4), latestVersion: 4, status: "sending" });
    const out = afterResult(fresh, "Modify", { ok: true }, 2, 0);
    expect(out).toEqual({ acked: "committed", ackedVersion: 2, attempts: 0, status: "waiting", retryInSeconds: null, commitAttemptVersion: null });
    expect(nextMessage({ ...fresh, ...out })).toEqual({ send: "Modify", booking: fresh.latest });
  });
  test("three changes while undelivered: Commit then one Modify with the latest version", () => {
    // The Commit is built from the latest booking; if newer versions landed during the send, one Modify follows.
    let r = row({ latest: booking(3), latestVersion: 3, status: "sending" });
    const out = afterResult(r, "Commit", { ok: true }, 1, 0);
    r = { ...r, ...out };
    expect(out.status).toBe("waiting");
    expect(nextMessage(r)).toEqual({ send: "Modify", booking: r.latest });
    expect(r.latestVersion).toBe(3);
  });
  test("Commit of an already-cancelled booking -> waiting, then Cancel", () => {
    const r = row({ latest: booking(2, { cancelled: true }), latestVersion: 2, status: "sending" });
    const out = afterResult(r, "Commit", { ok: true }, 2, 0);
    expect(out.status).toBe("waiting");
    expect(nextMessage({ ...r, ...out })).toMatchObject({ send: "Cancel" });
  });
  test("Cancel sent, then a reopened version arrived -> waiting, next call reports needs attention", () => {
    const r = row({ acked: "committed", ackedVersion: 1, latest: booking(3), latestVersion: 3 });
    const out = afterResult(r, "Cancel", { ok: true }, 2, 0);
    expect(out.status).toBe("waiting");
    expect(nextMessage({ ...r, ...out })).toHaveProperty("needsAttention");
  });
  test("transient failures retry at 5, 15, 30, 60 s, then every 60 s, while under 30 minutes since the first", () => {
    expect(RETRY_SECONDS).toEqual([5, 15, 30, 60]);
    expect(RETRY_WINDOW_SECONDS).toBe(1800);
    const seen: Array<number | null> = [];
    let failingFor = 0;
    for (let attempts = 0; attempts < 8; attempts++) {
      const out = afterResult(row({ attempts, status: "sending" }), "Commit", fail(), 1, failingFor);
      expect(out).toMatchObject({ attempts: attempts + 1, status: "retrying", acked: "none" });
      seen.push(out.retryInSeconds);
      failingFor += out.retryInSeconds as number;
    }
    expect(seen).toEqual([5, 15, 30, 60, 60, 60, 60, 60]);
  });
  test("a transient failure 30 minutes or more after the first failure -> needs_attention", () => {
    expect(afterResult(row({ attempts: 33, status: "sending" }), "Commit", fail(), 1, 1799)).toMatchObject({ status: "retrying", retryInSeconds: 60 });
    expect(afterResult(row({ attempts: 34, status: "sending" }), "Commit", fail(), 1, 1800)).toEqual({
      acked: "none", ackedVersion: null, attempts: 35, status: "needs_attention", retryInSeconds: null, commitAttemptVersion: null,
    });
  });
  test("permanent failure -> needs_attention at once; a failed Commit leaves acked none", () => {
    expect(afterResult(row({ status: "sending" }), "Commit", fail(true), 1, 0)).toEqual({ acked: "none", ackedVersion: null, attempts: 1, status: "needs_attention", retryInSeconds: null, commitAttemptVersion: null });
  });
  test("a failure while a newer version arrived: the new version is a new message (waiting, attempts 0)", () => {
    const fresh = row({ acked: "committed", ackedVersion: 1, latest: booking(3), latestVersion: 3, status: "sending", attempts: 4, commitAttemptVersion: null });
    const waiting = { acked: "committed" as const, ackedVersion: 1, attempts: 0, status: "waiting" as const, retryInSeconds: null, commitAttemptVersion: null };
    expect(afterResult(fresh, "Modify", fail(), 2, 1700)).toEqual(waiting);
    // Even a permanent refusal of the old version: the newer one may well be fine, so it is sent, not parked.
    expect(afterResult(fresh, "Modify", fail(true), 2, 0)).toEqual(waiting);
  });
  test("a Commit whose outcome was unknown (v1) and that later succeeds with v2 acks v1, so a Modify follows", () => {
    // SiteMinder may have taken the first Commit (v1) and ignores the repeated Commit ID of the v2 one.
    const fresh = row({ latest: booking(2), latestVersion: 2, status: "sending", attempts: 1, commitAttemptVersion: 1 });
    const out = afterResult(fresh, "Commit", { ok: true }, 2, 0);
    expect(out).toEqual({ acked: "committed", ackedVersion: 1, attempts: 0, status: "waiting", retryInSeconds: null, commitAttemptVersion: null });
    expect(nextMessage({ ...fresh, ...out })).toEqual({ send: "Modify", booking: fresh.latest });
    // Without an unknown earlier Commit, the Commit's own version is acked.
    expect(afterResult({ ...fresh, commitAttemptVersion: 2 }, "Commit", { ok: true }, 2, 0)).toMatchObject({ ackedVersion: 2, status: "delivered" });
  });
  test("a failure keeps the version of the first Commit attempt", () => {
    expect(afterResult(row({ status: "sending", commitAttemptVersion: 1 }), "Commit", fail(), 1, 0)).toMatchObject({ commitAttemptVersion: 1, status: "retrying" });
  });
  test("failure keeps the acked state", () => {
    const r = row({ acked: "committed", ackedVersion: 1, latest: booking(2), latestVersion: 2 });
    expect(afterResult(r, "Modify", fail(), 2, 0)).toMatchObject({ acked: "committed", ackedVersion: 1, status: "retrying", retryInSeconds: 5 });
  });
});
