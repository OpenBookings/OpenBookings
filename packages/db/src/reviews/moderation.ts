/**
 * Moderation of reviews and replies (0061). The words are checked, never the
 * score. A clean text publishes; anything else is held for a person, who
 * keeps or removes it. Nobody edits anyone's words: at the deadline a held
 * item publishes with the flagged fragments masked, and a moderator may still
 * decide it after that.
 *
 * Decisions are compare-and-set on `decided_at IS NULL`, so two tabs, or a
 * moderator and the deadline job, never both act on one item. The deadline
 * job never sets decided_at, so a decision after publish-by-deadline still
 * goes through (once).
 *
 * Rules, the deadline, the retention and the mask live in
 * @openbookings/pricing (moderation.ts).
 */
import {
  isReviewRuleId,
  maskFragments,
  MODERATION_DEADLINE_HOURS,
  MODERATION_RECORD_RETENTION_MONTHS,
  type ReviewRuleId,
  type TextCheck,
} from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;

export type ModerationItem = { kind: "review" | "reply"; id: string };

const TABLE = { review: "reviews", reply: "review_replies" } as const;
/** The body columns' CHECK limits (0038, 0039). */
const BODY_MAX = { review: 2000, reply: 1000 } as const;
/** When a held item's 72 hours started: a host's edit or a guest's rewrite restarts them. `t` is the item's alias. */
const heldSinceSql = (kind: ModerationItem["kind"], t: string) =>
  kind === "review" ? `${t}.created_at` : `COALESCE(${t}.edited_at, ${t}.created_at)`;

/**
 * Whether an item is still there to moderate: not deleted by its author, and
 * for a reply, its review neither. `t` is the item's alias.
 */
const liveSql = (kind: ModerationItem["kind"], t: string) =>
  kind === "review"
    ? `${t}.status <> 'deleted'`
    : `${t}.status <> 'deleted' AND EXISTS (SELECT 1 FROM reviews rv WHERE rv.id = ${t}.review_id AND rv.status <> 'deleted')`;

/**
 * Whether a moderator may decide it now: held or published, still there.
 * Never a hidden row, or one removed before moderation existed.
 */
const decidableSql = (kind: ModerationItem["kind"], t: string) => `${t}.status IN ('pending', 'published') AND ${liveSql(kind, t)}`;

/** What a check's outcome stores on the item. */
export type StoredCheck = {
  status: "published" | "pending";
  flaggedReason: string | null;
  /** JSON array of strings, for a jsonb parameter. */
  fragments: string;
  source: "regex" | "mistral" | "unchecked";
  checkedAt: Date | null;
};

/**
 * Published when clean, else held. An unchecked item (the model failed) keeps
 * whatever the regex found and waits for the recheck.
 */
export function storedCheck(check: TextCheck, now: Date): StoredCheck {
  const rules = [...new Set(check.rules.filter(isReviewRuleId))];
  const fragments = check.fragments.filter((f) => typeof f === "string" && f.length > 0);
  return {
    status: check.verdict === "clean" ? "published" : "pending",
    flaggedReason: rules.join(",") || null,
    fragments: JSON.stringify(fragments),
    source: check.verdict === "unchecked" ? "unchecked" : check.source,
    checkedAt: check.verdict === "unchecked" ? null : now,
  };
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type DecideResult =
  | { ok: true; reportsClosed: number; reportIds: string[] }
  | { ok: false; error: "already_decided" | "not_found" | "rules_required" };

/**
 * Keep or Remove. Remove sets the item 'removed'. Keep means a person judged
 * the words fine, so it publishes them as written: a deadline-published item
 * loses its mask (published_by_deadline stays true, as history). The item's
 * open reports close as upheld (removed) or dismissed (kept); `reportIds`
 * names them for the outcome emails.
 *
 * Only a held or published item is decided. Run it in a transaction: it is
 * two statements (the item, then its reports), and they stand or fall
 * together.
 */
export async function decideItem(
  db: Queryable,
  i: { item: ModerationItem; decision: "kept" | "removed"; rules: ReviewRuleId[]; note: string | null; decidedBy: string; now: Date },
): Promise<DecideResult> {
  const { kind, id } = i.item;
  if (!Object.hasOwn(TABLE, kind) || !UUID.test(id)) return { ok: false, error: "not_found" };
  const rules = [...new Set(i.rules.filter(isReviewRuleId))];
  if (i.decision === "removed" && rules.length === 0) return { ok: false, error: "rules_required" };
  const table = TABLE[kind];
  const note = i.note?.trim() || null;

  const { rows } = await db.query(
    `UPDATE ${table} t
        SET decision = $2, decision_rules = $3::text[], decision_note = $4, decided_by = $5, decided_at = $6, updated_at = $6,
            status = CASE WHEN $2 = 'removed' THEN 'removed' ELSE 'published' END,
            published_at = CASE WHEN $2 = 'kept' THEN COALESCE(t.published_at, $6) ELSE t.published_at END,
            masked_body = CASE WHEN $2 = 'kept' THEN NULL ELSE t.masked_body END
      WHERE t.id = $1::uuid AND t.decided_at IS NULL AND ${decidableSql(kind, "t")}
      RETURNING t.id`,
    [id, i.decision, rules, note, i.decidedBy, i.now],
  );
  if (rows.length === 0) {
    const decided =
      (await db.query(`SELECT 1 FROM ${table} t WHERE t.id = $1::uuid AND t.decided_at IS NOT NULL AND ${liveSql(kind, "t")}`, [id]))
        .rows.length > 0;
    return { ok: false, error: decided ? "already_decided" : "not_found" };
  }

  const reports = await db.query(
    `UPDATE review_reports SET status = $2, decided_at = $3
      WHERE status = 'open' AND ${kind === "review" ? "review_id = $1::uuid AND reply_id IS NULL" : "reply_id = $1::uuid"}
      RETURNING id`,
    [id, i.decision === "removed" ? "upheld" : "dismissed", i.now],
  );
  const reportIds = (reports.rows as { id: string }[]).map((r) => r.id);
  return { ok: true, reportsClosed: reportIds.length, reportIds };
}

/**
 * Closes a deleted item's open reports as dismissed: there is nothing left to
 * decide. With `replyId` null, every report on the (deleted) review and its
 * replies; otherwise those on the (deleted) reply.
 *
 * Through app.dismiss_deleted_review_reports (0061): under the app roles the
 * guest or host who deleted the item can't see other people's reports
 * (public ones included), so row-level security would quietly skip them.
 */
export async function dismissReportsOfDeleted(
  db: Queryable,
  i: { reviewId: string; replyId: string | null; now: Date },
): Promise<number> {
  const { rows } = await db.query(`SELECT app.dismiss_deleted_review_reports($1::uuid, $2::uuid, $3) AS n`, [
    i.reviewId,
    i.replyId,
    i.now,
  ]);
  return (rows[0] as { n: number }).n;
}

// ── The deadline ─────────────────────────────────────────────────────────────

type HeldRow = { id: string; body: string | null; flagged_fragments: string[] };

/**
 * Publishes every held item nobody decided within MODERATION_DEADLINE_HOURS,
 * each flagged fragment replaced by "[removed]" (masked_body; the original
 * stays for the moderator until the purge). A reply's clock restarts when its
 * host edits it, a review's when its guest rewrites it. Returns how many.
 *
 * An item never checked under 0061 (check_source NULL) never publishes here:
 * 0061 marks the held ones 'unchecked' so the recheck finds their fragments.
 * The final UPDATE repeats every condition, so an edit or decision landing
 * after the SELECT is never published with a mask of the old text.
 */
export async function publishOverdue(db: Queryable, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MODERATION_DEADLINE_HOURS * HOUR);
  const held = {
    review: (
      await db.query(
        `SELECT t.id, t.body, t.flagged_fragments FROM reviews t
          WHERE t.status = 'pending' AND t.decided_at IS NULL AND t.check_source IS NOT NULL AND ${heldSinceSql("review", "t")} <= $1
          ORDER BY t.created_at
            FOR UPDATE SKIP LOCKED`,
        [cutoff],
      )
    ).rows as HeldRow[],
    reply: (
      await db.query(
        `SELECT rr.id, rr.body, rr.flagged_fragments FROM review_replies rr
          WHERE rr.status = 'pending' AND rr.decided_at IS NULL AND rr.check_source IS NOT NULL
            AND ${heldSinceSql("reply", "rr")} <= $1 AND ${liveSql("reply", "rr")}
          ORDER BY rr.created_at
            FOR UPDATE OF rr SKIP LOCKED`,
        [cutoff],
      )
    ).rows as HeldRow[],
  };
  let published = 0;
  for (const kind of ["review", "reply"] as const) {
    for (const row of held[kind]) {
      const fragments = Array.isArray(row.flagged_fragments) ? row.flagged_fragments : [];
      const masked = row.body && fragments.length > 0 ? maskFragments(row.body, fragments) : null;
      const { rows } = await db.query(
        `UPDATE ${TABLE[kind]} t
            SET status = 'published', published_at = $2, masked_body = $3, published_by_deadline = true, updated_at = $2
          WHERE t.id = $1 AND t.status = 'pending' AND t.decided_at IS NULL AND t.check_source IS NOT NULL
            AND ${heldSinceSql(kind, "t")} <= $4 AND t.body IS NOT DISTINCT FROM $5 AND ${liveSql(kind, "t")}
          RETURNING t.id`,
        [row.id, now, masked, cutoff, row.body],
      );
      published += rows.length;
    }
  }
  return published;
}

// ── The recheck ──────────────────────────────────────────────────────────────

/** Held items the model couldn't check (failed or timed out), oldest first. */
export async function uncheckedItems(db: Queryable, limit: number): Promise<Array<ModerationItem & { body: string }>> {
  const { rows } = await db.query(
    `SELECT kind, id, body FROM (
       SELECT 'review' AS kind, rv.id, rv.body, rv.created_at FROM reviews rv
        WHERE rv.status = 'pending' AND rv.check_source = 'unchecked' AND rv.decided_at IS NULL AND rv.body IS NOT NULL
       UNION ALL
       SELECT 'reply' AS kind, rr.id, rr.body, rr.created_at FROM review_replies rr
        WHERE rr.status = 'pending' AND rr.check_source = 'unchecked' AND rr.decided_at IS NULL AND rr.body IS NOT NULL
          AND ${liveSql("reply", "rr")}
     ) held
     ORDER BY created_at, id
     LIMIT $1`,
    [limit],
  );
  return rows as Array<ModerationItem & { body: string }>;
}

/**
 * Stores a recheck of an unchecked item: published when clean, else held with
 * what was found. A recheck that is itself unchecked changes nothing. Only an
 * item still held, unchecked and undecided is touched.
 */
export async function applyRecheck(db: Queryable, item: ModerationItem, check: TextCheck, now: Date): Promise<void> {
  if (!Object.hasOwn(TABLE, item.kind) || !UUID.test(item.id) || check.verdict === "unchecked") return;
  const s = storedCheck(check, now);
  await db.query(
    `UPDATE ${TABLE[item.kind]}
        SET status = $2, flagged_reason = $3, flagged_fragments = $4::jsonb, check_source = $5, checked_at = $6, updated_at = $6,
            published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, $6) ELSE published_at END
      WHERE id = $1::uuid AND status = 'pending' AND check_source = 'unchecked' AND decided_at IS NULL`,
    [item.id, s.status, s.flaggedReason, s.fragments, s.source, now],
  );
}

// ── Retention ────────────────────────────────────────────────────────────────

/**
 * After MODERATION_RECORD_RETENTION_MONTHS:
 *   - reports go: closed ones counted from their decision, open ones (never
 *     decided) from when they were made;
 *   - a removed item loses its text, masked or not, and the flagged fragments
 *     that quote it, counted from the decision (the row stays: a review keeps
 *     its score and the booking stays reviewed, a reply keeps its turn in the
 *     thread);
 *   - an item published masked by the deadline that nobody ever decided keeps
 *     only its masked text, counted from that publication.
 * A kept item has nothing to purge: Keep published it as written.
 */
export async function purgeModerationRecords(db: Queryable, now: Date): Promise<{ reports: number; texts: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MODERATION_RECORD_RETENTION_MONTHS);

  const reports = await db.query(
    `DELETE FROM review_reports
      WHERE (status <> 'open' AND decided_at <= $1) OR (status = 'open' AND created_at <= $1)
      RETURNING id`,
    [cutoff],
  );
  let texts = 0;
  for (const kind of ["review", "reply"] as const) {
    const table = TABLE[kind];
    const removed = await db.query(
      `UPDATE ${table}
          SET body = NULL, masked_body = NULL, flagged_fragments = '[]', updated_at = $2
        WHERE status = 'removed' AND decided_at <= $1
          AND (body IS NOT NULL OR masked_body IS NOT NULL OR flagged_fragments <> '[]')
        RETURNING id`,
      [cutoff, now],
    );
    // left(): masking short fragments can lengthen a text past the column's
    // limit, and one such row must not stop the purge.
    const masked = await db.query(
      `UPDATE ${table}
          SET body = left(masked_body, ${BODY_MAX[kind]}), masked_body = NULL, flagged_fragments = '[]', updated_at = $2
        WHERE published_by_deadline AND decided_at IS NULL AND masked_body IS NOT NULL AND published_at <= $1
        RETURNING id`,
      [cutoff, now],
    );
    texts += removed.rows.length + masked.rows.length;
  }
  return { reports: reports.rows.length, texts };
}
