import { describe, expect, test } from "bun:test";
import { removedReview } from "./removed-review";

const removed = { status: "removed" as const };
const open = { ok: true as const, closesAt: new Date("2026-12-01T00:00:00Z") };

describe("removedReview", () => {
  test("not about a removed review: nothing to say", () => {
    expect(removedReview({ review: null, eligibility: open })).toBeNull();
    expect(removedReview({ review: { status: "published" }, eligibility: { ok: false, reason: "already_reviewed" } })).toBeNull();
    expect(removedReview({ review: { status: "pending" }, eligibility: { ok: false, reason: "already_reviewed" } })).toBeNull();
    expect(removedReview({ review: { status: "deleted" }, eligibility: { ok: false, reason: "already_reviewed" } })).toBeNull();
  });

  test("removed, rewrite unused, window open: the form again, with a line saying why", () => {
    expect(removedReview({ review: removed, eligibility: open })).toEqual({
      canRewrite: true,
      message: "Your earlier review was removed because it broke our review rules. You can write it once more.",
    });
  });

  test("removed after the one rewrite: it says the stay can't be reviewed again", () => {
    const r = removedReview({ review: removed, eligibility: { ok: false, reason: "already_reviewed" } });
    expect(r?.canRewrite).toBe(false);
    expect(r?.message).toBe(
      "Your review was removed because it broke our review rules. It was already written once more, so this stay can't be reviewed again.",
    );
  });

  test("removed, window closed: it says the time to write it again has passed", () => {
    const r = removedReview({ review: removed, eligibility: { ok: false, reason: "window_closed" } });
    expect(r?.canRewrite).toBe(false);
    expect(r?.message).toBe(
      "Your review was removed because it broke our review rules. Reviews can be written up to 30 days after check-out, so it can't be written again.",
    );
  });

  test("removed, and the stay can no longer be reviewed for another reason", () => {
    const r = removedReview({ review: removed, eligibility: { ok: false, reason: "no_show" } });
    expect(r).toEqual({
      canRewrite: false,
      message: "Your review was removed because it broke our review rules. This stay can't be reviewed again.",
    });
  });
});
