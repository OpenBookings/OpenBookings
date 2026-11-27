"use server";

import { revalidatePath } from "next/cache";
import { propertyReviewsKey, purge } from "@openbookings/cache";
import { dangerousAction } from "./dangerous";
import type { Confirmation, DangerousResult } from "./dangerous-actions";
import { withWriteTransaction, writePool } from "./db";
import {
  DECISION_ERRORS,
  keepItem,
  parseItem,
  readOnlyAsRefusal,
  removalOf,
  removeItem,
  type DecisionDeps,
  type DecisionResult,
} from "./moderation";
import { requireStaff } from "./staff";

/**
 * Keep and Remove on the review moderation queue (/reviews), on the write
 * connection (ob_admin_write). Keep is not dangerous: it publishes words as
 * their author wrote them (an audit row with an optional reason, in the
 * decision's transaction). Remove is (./dangerous.ts): a reason, a step-up
 * for the item, and an audit row first.
 *
 * Both send their emails after the decision commits (./moderation.ts) and
 * drop the property's cached reviews in Upstash (UPSTASH_REDIS_REST_URL and
 * _TOKEN, as apps/web has them), so the public page shows the decision at its
 * next rebuild (it revalidates every 5 minutes) rather than a day later.
 * Without those settings only the cache's own day-long expiry applies.
 */

const liveDeps = (): DecisionDeps => ({
  transaction: withWriteTransaction,
  mail: { db: writePool() },
  purgeReviews: (propertyId) =>
    purge([propertyReviewsKey(propertyId)], {
      onError: (error) => console.error("[admin] could not purge the property's cached reviews", error),
    }),
  report: (error, context) => console.error("[admin] review moderation step failed", { step: context }, error),
  now: new Date(),
});

const gone = { ok: false, error: DECISION_ERRORS.not_found } as const;

export async function adminKeepItem(item: unknown, version: string, reason?: unknown): Promise<DecisionResult> {
  const staff = await requireStaff();
  const parsed = parseItem(item);
  if (!parsed) return gone;
  return readOnlyAsRefusal(async () => {
    const result = await keepItem(liveDeps(), {
      item: parsed,
      version,
      decidedBy: staff.userId,
      actorEmail: staff.email,
      reason,
    });
    revalidatePath("/reviews");
    return result;
  });
}

export async function adminRemoveItem(
  i: { item: unknown; version: string; rules: string[]; note: string | null },
  confirm: Confirmation,
): Promise<DangerousResult<DecisionResult>> {
  await requireStaff();
  const item = parseItem(i?.item);
  if (!item) return { ok: true, value: gone };
  // What the decision will use, and the audit row records. Refused before the step-up is spent.
  const removal = removalOf(i.rules, i.note);
  if (removal.rules.length === 0) return { ok: true, value: { ok: false, error: DECISION_ERRORS.rules_required } };
  return dangerousAction(
    {
      action: "review.remove",
      targetType: item.kind === "review" ? "review" : "review_reply",
      targetId: item.id,
      reason: confirm?.reason,
      stepUpToken: confirm?.stepUpToken,
      detail: removal,
    },
    async (staff) => {
      const result = await removeItem(liveDeps(), { item, version: i.version, ...removal, decidedBy: staff.userId });
      revalidatePath("/reviews");
      return result;
    },
  );
}
