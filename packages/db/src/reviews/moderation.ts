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
 * goes through (once). A kept item with an open report may be decided once
 * more (openToDecideSql).
 *
 * Rules, the deadline, the retention and the mask live in
 * @openbookings/pricing (moderation.ts).
 */
import {
  isReviewRuleId,
  maskFragments,
  MODERATION_DEADLINE_HOURS,
  MODERATION_RECORD_RETENTION_MONTHS,
  type AuthorModeration,
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
 * The version of an item a moderator judges: when its words were written
 * (heldSinceSql), in microseconds as text, so it survives a round trip
 * through the browser exactly. A host's edit or a guest's rewrite changes it;
 * a recheck or the deadline doesn't (the words stay the same). The admin
 * queue loads it, and decideItem refuses a decision on another version.
 */
export const moderationVersionSql = (kind: ModerationItem["kind"], t: string) =>
  `(extract(epoch FROM ${heldSinceSql(kind, t)}) * 1000000)::bigint::text`;

// ── What the author sees ─────────────────────────────────────────────────────

/**
 * An item's moderation as its own author may see it (AuthorModeration in
 * @openbookings/pricing), as one JSON value: `${t}` is the item's alias.
 * Only for the author's own pages: it carries the original text.
 */
export const authorModerationSql = (kind: ModerationItem["kind"], t: string) => `json_build_object(
  'written', ${t}.body, 'flagged_reason', ${t}.flagged_reason, 'decision', ${t}.decision,
  'decision_rules', ${t}.decision_rules, 'decision_note', ${t}.decision_note, 'decided_at', ${t}.decided_at,
  'published_by_deadline', ${t}.published_by_deadline, 'masked_body', ${t}.masked_body,
  'text_purged', ${t}.text_purged_at IS NOT NULL, 'deadline_may', ${deadlineMaySql(t)},
  'held_since', ${heldSinceSql(kind, t)})`;

type AuthorModerationJson = {
  written: string | null;
  flagged_reason: string | null;
  decision: "kept" | "removed" | null;
  decision_rules: string[] | null;
  decision_note: string | null;
  decided_at: string | null;
  published_by_deadline: boolean;
  masked_body: string | null;
  text_purged: boolean;
  deadline_may: boolean;
  held_since: string;
};

const knownRules = (ids: readonly string[]): ReviewRuleId[] => [...new Set(ids.map((s) => s.trim()).filter(isReviewRuleId))];
const isoOf = (v: string | Date) => new Date(v).toISOString();

/** Reads authorModerationSql's value. Rule ids the pricing package doesn't know are dropped. */
export function toAuthorModeration(j: AuthorModerationJson): AuthorModeration {
  return {
    written: j.written,
    flaggedRules: knownRules((j.flagged_reason ?? "").split(",")),
    decision: j.decision,
    decisionRules: knownRules(j.decision_rules ?? []),
    decisionNote: j.decision_note,
    decidedAt: j.decided_at ? isoOf(j.decided_at) : null,
    publishedByDeadline: j.published_by_deadline,
    maskedBody: j.masked_body,
    textPurged: j.text_purged === true,
    deadlineMay: j.deadline_may === true,
    heldSince: isoOf(j.held_since),
  };
}

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

/** The item's own reports (a review's, not its replies'). `t` is the item's alias, `rp` the report's. */
const reportsOfSql = (kind: ModerationItem["kind"], t: string) =>
  kind === "review" ? `rp.review_id = ${t}.id AND rp.reply_id IS NULL` : `rp.reply_id = ${t}.id`;

/**
 * Whether a moderator may decide it (again): nobody has, or it has an open
 * report. A decision closes every open report on the item, so one that is
 * open after a decision is new, or raced the decision: either way a person
 * hasn't looked at it. So a problem missed at a Keep stays reportable. A
 * removed item isn't published, so it can't be reported again. `t` is the
 * item's alias.
 */
const openToDecideSql = (kind: ModerationItem["kind"], t: string) =>
  `(${t}.decided_at IS NULL OR EXISTS (SELECT 1 FROM review_reports rp WHERE rp.status = 'open' AND ${reportsOfSql(kind, t)}))`;

/** An item's property, whose public page shows it. `t` is the item's alias. */
const propertyIdSql = (kind: ModerationItem["kind"], t: string) =>
  kind === "review" ? `${t}.property_id` : `(SELECT rv.property_id FROM reviews rv WHERE rv.id = ${t}.review_id)`;

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
  /** `propertyId`: whose public page shows (or showed) the item. */
  | { ok: true; reportsClosed: number; reportIds: string[]; propertyId: string }
  | { ok: false; error: "already_decided" | "changed" | "not_found" | "rules_required" };

/**
 * Keep or Remove. Remove sets the item 'removed'. Keep means a person judged
 * the words fine, so it publishes them as written: a deadline-published item
 * loses its mask (published_by_deadline stays true, as history). The item's
 * open reports close as upheld (removed) or dismissed (kept); `reportIds`
 * names them for the outcome emails.
 *
 * Only a held or published item is decided, and only once, unless it was
 * kept and has an open report (then once more). With `version` (as
 * moderationVersionSql read it when the moderator opened the item), only that
 * version: an item edited since answers "changed", so a stale tab never
 * decides words nobody looked at. Already decided wins over changed.
 *
 * Run it in a transaction: it is two statements (the item, then its reports),
 * and they stand or fall together.
 */
export async function decideItem(
  db: Queryable,
  i: {
    item: ModerationItem;
    decision: "kept" | "removed";
    rules: ReviewRuleId[];
    note: string | null;
    decidedBy: string;
    now: Date;
    version?: string;
  },
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
      WHERE t.id = $1::uuid AND ${openToDecideSql(kind, "t")} AND ${decidableSql(kind, "t")}
        AND ($7::text IS NULL OR ${moderationVersionSql(kind, "t")} = $7::text)
      RETURNING t.id, ${propertyIdSql(kind, "t")} AS property_id`,
    [id, i.decision, rules, note, i.decidedBy, i.now, i.version ?? null],
  );
  const decided = rows[0] as { property_id: string } | undefined;
  if (!decided) {
    const found = (
      await db.query(
        `SELECT NOT ${openToDecideSql(kind, "t")} AS decided, (${decidableSql(kind, "t")}) AS decidable
           FROM ${table} t WHERE t.id = $1::uuid AND ${liveSql(kind, "t")}`,
        [id],
      )
    ).rows[0] as { decided: boolean; decidable: boolean } | undefined;
    if (found?.decided) return { ok: false, error: "already_decided" };
    // Still there and undecided, so only the version stopped it.
    return { ok: false, error: found?.decidable && i.version !== undefined ? "changed" : "not_found" };
  }

  const reports = await db.query(
    `UPDATE review_reports SET status = $2, decided_at = $3
      WHERE status = 'open' AND ${kind === "review" ? "review_id = $1::uuid AND reply_id IS NULL" : "reply_id = $1::uuid"}
      RETURNING id`,
    [id, i.decision === "removed" ? "upheld" : "dismissed", i.now],
  );
  const reportIds = (reports.rows as { id: string }[]).map((r) => r.id);
  return { ok: true, reportsClosed: reportIds.length, reportIds, propertyId: decided.property_id };
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
 * Whether the deadline may publish the item. `t` is the item's alias.
 *   - Never one checked before 0061 (check_source NULL): 0061 marks the held
 *     ones 'unchecked' so the recheck finds their fragments.
 *   - Never one held for a reason (a rule, or a reason of the check before
 *     0061) whose stored fragments mask nothing in its text: nobody could say
 *     which words broke the rule, so a mask would publish the very words it
 *     was held for. It waits for a person (and, if unchecked, a recheck that
 *     finds them). A fragment counts when it occurs in the text exactly, as
 *     maskFragments finds it (strpos: literal and case-sensitive).
 * Held for no reason (the model couldn't run, the contact check found
 * nothing), it publishes as written. The admin queue reads the same
 * expression, so its badges never disagree with the job.
 */
export const deadlineMaySql = (t: string) =>
  `(${t}.check_source IS NOT NULL AND (${t}.flagged_reason IS NULL OR EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${t}.flagged_fragments) = 'array' THEN ${t}.flagged_fragments ELSE '[]'::jsonb END) AS f(fragment)
      WHERE f.fragment <> '' AND strpos(${t}.body, f.fragment) > 0)))`;

/**
 * Publishes every held item nobody decided within MODERATION_DEADLINE_HOURS,
 * each flagged fragment replaced by "[removed]" (masked_body; the original
 * stays for the moderator until the purge). A reply's clock restarts when its
 * host edits it, a review's when its guest rewrites it. Returns how many, and
 * the properties whose public pages now show them (to refresh their caches).
 *
 * Some held items never publish here (deadlineMaySql): past the deadline,
 * they come back as `waiting`, for the job to raise. The final UPDATE
 * repeats every condition, so an edit or decision landing after the SELECT is
 * never published with a mask of the old text.
 */
export async function publishOverdue(
  db: Queryable,
  now: Date,
): Promise<{ published: number; propertyIds: string[]; masked: ModerationItem[]; waiting: ModerationItem[] }> {
  const cutoff = new Date(now.getTime() - MODERATION_DEADLINE_HOURS * HOUR);
  const held = {
    review: (
      await db.query(
        `SELECT t.id, t.body, t.flagged_fragments FROM reviews t
          WHERE t.status = 'pending' AND t.decided_at IS NULL AND ${deadlineMaySql("t")} AND ${heldSinceSql("review", "t")} <= $1
          ORDER BY t.created_at
            FOR UPDATE SKIP LOCKED`,
        [cutoff],
      )
    ).rows as HeldRow[],
    reply: (
      await db.query(
        `SELECT rr.id, rr.body, rr.flagged_fragments FROM review_replies rr
          WHERE rr.status = 'pending' AND rr.decided_at IS NULL AND ${deadlineMaySql("rr")}
            AND ${heldSinceSql("reply", "rr")} <= $1 AND ${liveSql("reply", "rr")}
          ORDER BY rr.created_at
            FOR UPDATE OF rr SKIP LOCKED`,
        [cutoff],
      )
    ).rows as HeldRow[],
  };
  let published = 0;
  const propertyIds = new Set<string>();
  const maskedItems: ModerationItem[] = [];
  for (const kind of ["review", "reply"] as const) {
    for (const row of held[kind]) {
      const fragments = Array.isArray(row.flagged_fragments) ? row.flagged_fragments : [];
      // Only a mask that removed something: fragments the text doesn't hold publish it as written, with no notice.
      const maskedText = row.body && fragments.length > 0 ? maskFragments(row.body, fragments) : null;
      const masked = maskedText !== null && maskedText !== row.body ? maskedText : null;
      const { rows } = await db.query(
        `UPDATE ${TABLE[kind]} t
            SET status = 'published', published_at = $2, masked_body = $3, published_by_deadline = true, updated_at = $2
          WHERE t.id = $1 AND t.status = 'pending' AND t.decided_at IS NULL AND ${deadlineMaySql("t")}
            AND ${heldSinceSql(kind, "t")} <= $4 AND t.body IS NOT DISTINCT FROM $5 AND ${liveSql(kind, "t")}
          RETURNING ${propertyIdSql(kind, "t")} AS property_id`,
        [row.id, now, masked, cutoff, row.body],
      );
      for (const r of rows as { property_id: string }[]) propertyIds.add(r.property_id);
      published += rows.length;
      // Only this run's compare-and-set winner reports the item, so a notice goes out once.
      if (rows.length > 0 && masked !== null) maskedItems.push({ kind, id: row.id });
    }
  }
  return { published, propertyIds: [...propertyIds], masked: maskedItems, waiting: await waitingPastDeadline(db, cutoff) };
}

/**
 * Held items past the deadline that it won't publish (deadlineMaySql) and
 * nobody has decided: they wait for a person. Only the item, never its text.
 */
async function waitingPastDeadline(db: Queryable, cutoff: Date): Promise<ModerationItem[]> {
  const { rows } = await db.query(
    `SELECT 'review' AS kind, t.id FROM reviews t
      WHERE t.status = 'pending' AND t.decided_at IS NULL AND NOT ${deadlineMaySql("t")} AND ${heldSinceSql("review", "t")} <= $1
     UNION ALL
     SELECT 'reply' AS kind, rr.id FROM review_replies rr
      WHERE rr.status = 'pending' AND rr.decided_at IS NULL AND NOT ${deadlineMaySql("rr")}
        AND ${heldSinceSql("reply", "rr")} <= $1 AND ${liveSql("reply", "rr")}
     ORDER BY kind, id`,
    [cutoff],
  );
  return rows as ModerationItem[];
}

// ── The recheck ──────────────────────────────────────────────────────────────

/**
 * Held items the model couldn't check (failed or timed out). Least recently
 * tried first (updated_at; a failed recheck touches it, see applyRecheck), so
 * items whose recheck keeps failing go to the back and can't starve the rest.
 */
export async function uncheckedItems(db: Queryable, limit: number): Promise<Array<ModerationItem & { body: string }>> {
  const { rows } = await db.query(
    `SELECT kind, id, body FROM (
       SELECT 'review' AS kind, rv.id, rv.body, rv.created_at, rv.updated_at FROM reviews rv
        WHERE rv.status = 'pending' AND rv.check_source = 'unchecked' AND rv.decided_at IS NULL AND rv.body IS NOT NULL
       UNION ALL
       SELECT 'reply' AS kind, rr.id, rr.body, rr.created_at, rr.updated_at FROM review_replies rr
        WHERE rr.status = 'pending' AND rr.check_source = 'unchecked' AND rr.decided_at IS NULL AND rr.body IS NOT NULL
          AND ${liveSql("reply", "rr")}
     ) held
     ORDER BY updated_at, created_at, id
     LIMIT $1`,
    [limit],
  );
  return rows as Array<ModerationItem & { body: string }>;
}

/**
 * Stores a recheck of an unchecked item: published when clean, else held with
 * what was found. A recheck that is itself unchecked only marks the attempt
 * (updated_at), so uncheckedItems tries other items first. Only an
 * item still held, unchecked and undecided is touched, and, given the `body`
 * that was checked, only while its text is still that (an edit during the
 * check has a check of its own). Returns whether it was stored, and the
 * property whose public page shows it when it published.
 */
export async function applyRecheck(
  db: Queryable,
  item: ModerationItem & { body?: string },
  check: TextCheck,
  now: Date,
): Promise<{ stored: boolean; publishedPropertyId: string | null }> {
  if (!Object.hasOwn(TABLE, item.kind) || !UUID.test(item.id)) return { stored: false, publishedPropertyId: null };
  if (check.verdict === "unchecked") {
    await db.query(
      `UPDATE ${TABLE[item.kind]} t SET updated_at = $2
        WHERE t.id = $1::uuid AND t.status = 'pending' AND t.check_source = 'unchecked' AND t.decided_at IS NULL`,
      [item.id, now],
    );
    return { stored: false, publishedPropertyId: null };
  }
  const s = storedCheck(check, now);
  const { rows } = await db.query(
    `UPDATE ${TABLE[item.kind]} t
        SET status = $2, flagged_reason = $3, flagged_fragments = $4::jsonb, check_source = $5, checked_at = $6, updated_at = $6,
            published_at = CASE WHEN $2 = 'published' THEN COALESCE(t.published_at, $6) ELSE t.published_at END
      WHERE t.id = $1::uuid AND t.status = 'pending' AND t.check_source = 'unchecked' AND t.decided_at IS NULL
        AND ($7::text IS NULL OR t.body = $7)
      RETURNING t.status, ${propertyIdSql(item.kind, "t")} AS property_id`,
    [item.id, s.status, s.flaggedReason, s.fragments, s.source, now, item.body ?? null],
  );
  const updated = rows[0] as { status: string; property_id: string } | undefined;
  return { stored: !!updated, publishedPropertyId: updated?.status === "published" ? updated.property_id : null };
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
 * Either way text_purged_at records it, so nobody mistakes a purged text for
 * one never written (a score-only review), and a purged deadline item
 * leaves the queue (nothing is left to decide about its original words).
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
          SET body = NULL, masked_body = NULL, flagged_fragments = '[]', text_purged_at = $2, updated_at = $2
        WHERE status = 'removed' AND decided_at <= $1
          AND (body IS NOT NULL OR masked_body IS NOT NULL OR flagged_fragments <> '[]')
        RETURNING id`,
      [cutoff, now],
    );
    // left(): masking short fragments can lengthen a text past the column's
    // limit, and one such row must not stop the purge.
    const masked = await db.query(
      `UPDATE ${table}
          SET body = left(masked_body, ${BODY_MAX[kind]}), masked_body = NULL, flagged_fragments = '[]', text_purged_at = $2,
              updated_at = $2
        WHERE published_by_deadline AND decided_at IS NULL AND masked_body IS NOT NULL AND published_at <= $1
        RETURNING id`,
      [cutoff, now],
    );
    texts += removed.rows.length + masked.rows.length;
  }
  return { reports: reports.rows.length, texts };
}
