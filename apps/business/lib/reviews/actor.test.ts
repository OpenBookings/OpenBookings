import { describe, expect, test } from "bun:test";
import { messageFor, reviewActor } from "./actor";

const REVIEW = "11111111-1111-4111-8111-111111111111";
const REPLY = "22222222-2222-4222-8222-222222222222";
const session = { user: { id: "u1", account_type: "business" } };

function deps(row: { property_id: string; review_id: string } | null, allowed: boolean) {
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      queryOne: async <T,>(_sql: string, values: unknown[] = []) => {
        calls.push(values);
        return row as T | null;
      },
      userCan: async (_s: unknown, propertyId: string, permission: unknown) => {
        calls.push([propertyId, permission]);
        return allowed;
      },
    },
  };
}

describe("reviewActor", () => {
  test("the owner gets the property and review", async () => {
    const { deps: d, calls } = deps({ property_id: "p1", review_id: REVIEW }, true);
    expect(await reviewActor(session, { reviewId: REVIEW }, d)).toEqual({ userId: "u1", propertyId: "p1", reviewId: REVIEW });
    expect(calls).toContainEqual(["p1", { booking: ["read"] }]);
  });

  test("a member without booking read gets nothing", async () => {
    const { deps: d } = deps({ property_id: "p1", review_id: REVIEW }, false);
    expect(await reviewActor(session, { reviewId: REVIEW }, d)).toBeNull();
  });

  test("an unknown id gets nothing", async () => {
    const { deps: d } = deps(null, true);
    expect(await reviewActor(session, { replyId: REPLY }, d)).toBeNull();
  });

  test("a malformed id never reaches the database", async () => {
    const { deps: d, calls } = deps({ property_id: "p1", review_id: REVIEW }, true);
    expect(await reviewActor(session, { reviewId: "nope" }, d)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("no session gets nothing", async () => {
    const { deps: d } = deps({ property_id: "p1", review_id: REVIEW }, true);
    expect(await reviewActor(null, { reviewId: REVIEW }, d)).toBeNull();
  });
});

describe("messageFor", () => {
  test("uses the agreed copy", () => {
    expect(messageFor("not_your_turn")).toBe("It's the guest's turn to answer. You can reply again after they do.");
    expect(messageFor("invalid")).toBe("Write between 1 and 1,000 characters.");
    expect(messageFor("thread_closed")).toBe("This thread is closed. Carry on in Messages.");
    expect(messageFor("not_found")).toBe("We couldn't find this review.");
  });
});
