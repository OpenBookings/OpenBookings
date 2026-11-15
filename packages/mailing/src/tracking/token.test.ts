import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { openToken, sealToken, type TrackingToken } from "./token";

const key = randomBytes(32);
const payload: TrackingToken = {
  v: 1,
  s: "7f0c1d2e-0000-4000-8000-000000000001",
  k: "booking_confirmed_guest",
  u: "11111111-1111-4111-8111-111111111111",
  t: 1_800_000_000,
  l: "cta",
  d: "https://openbookings.co/bookings/1",
};

describe("tracking token", () => {
  test("round trips", () => {
    expect(openToken(sealToken(payload, key), key)).toEqual(payload);
  });

  test("tampered token is rejected", () => {
    const token = sealToken(payload, key);
    const i = Math.floor(token.length / 2);
    const flipped = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
    expect(openToken(flipped, key)).toBeNull();
  });

  test("wrong key is rejected", () => {
    expect(openToken(sealToken(payload, key), randomBytes(32))).toBeNull();
  });

  test("garbage is rejected", () => {
    expect(openToken("not-a-token", key)).toBeNull();
    expect(openToken("", key)).toBeNull();
  });

  test("two seals of the same payload differ", () => {
    expect(sealToken(payload, key)).not.toBe(sealToken(payload, key));
  });

  test("unknown version is rejected", () => {
    const bad = { ...payload, v: 2 } as unknown as TrackingToken;
    expect(openToken(sealToken(bad, key), key)).toBeNull();
  });
});
