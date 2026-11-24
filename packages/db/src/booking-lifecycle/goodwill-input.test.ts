import { describe, expect, test } from "bun:test";
import { issueGoodwillRefund, type LifecycleDeps } from "./index";

// A database that fails the test if it is touched: the amount check has to
// happen before the booking is loaded, let alone before anything is inserted.
const untouchable: NonNullable<LifecycleDeps["db"]> = {
  query: () => {
    throw new Error("database touched");
  },
  transaction: () => {
    throw new Error("database touched");
  },
};
const deps: LifecycleDeps = { refund: async () => ({ id: "re_1" }) as never, db: untouchable };
const host = { kind: "host" as const, userId: "host-1" };

describe("issueGoodwillRefund input", () => {
  test("rejects NaN, Infinity and fractions of a cent before touching the database", async () => {
    for (const amountCents of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 12.5]) {
      await expect(issueGoodwillRefund(deps, { bookingId: "b", actor: host, amountCents })).rejects.toThrow(RangeError);
    }
  });

  test("rejects a non-number that got past the type system", async () => {
    await expect(
      issueGoodwillRefund(deps, { bookingId: "b", actor: host, amountCents: "1000" as unknown as number }),
    ).rejects.toThrow(RangeError);
  });

  test("a guest is still refused first, without an error", async () => {
    expect(
      await issueGoodwillRefund(deps, { bookingId: "b", actor: { kind: "guest", userId: "g" }, amountCents: Number.NaN }),
    ).toEqual({ ok: false, error: "not_allowed" });
  });
});
