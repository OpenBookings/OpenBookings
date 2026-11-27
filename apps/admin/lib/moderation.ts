import { decideItem, moderationVersionSql, type ModerationItem } from "@openbookings/db/reviews";
import {
  isReviewRuleId,
  MODERATION_DEADLINE_HOURS,
  projectedCheckOutAt,
  reviewWindow,
  type ReviewRuleId,
} from "@openbookings/pricing";
import { sendModerationDecision, sendReportOutcomes, type ReviewSendDeps } from "@openbookings/mailing/review-send";
import type { Queryable } from "./staff";

/**
 * The review moderation queue (/reviews): reviews and replies the check held,
 * the ones people reported, the ones the 72-hour deadline published with
 * parts masked, and what was decided. Keep and Remove go through decideItem
 * (@openbookings/db/reviews), which never decides one item twice.
 *
 * The score is shown, small, and is never part of the decision.
 *
 * Loaders take the read connection; keepItem and removeItem are given the
 * write one by the server actions (./moderation-actions.ts).
 */

export type ModerationTab = "held" | "reported" | "deadline" | "decided";
export const MODERATION_TABS: readonly ModerationTab[] = ["held", "reported", "deadline", "decided"];
export const isModerationTab = (v: unknown): v is ModerationTab =>
  typeof v === "string" && (MODERATION_TABS as readonly string[]).includes(v);

export type QueueReport = {
  id: string;
  reporterKind: "host" | "public";
  rule: ReviewRuleId;
  note: string | null;
  /** A public reporter left an email for the outcome (the address itself isn't loaded). */
  emailLeft: boolean;
  status: "open" | "upheld" | "dismissed";
  createdAt: Date;
};

export type QueueRow = {
  kind: ModerationItem["kind"];
  id: string;
  /** A reply's author: the property, or the guest answering it. Null for a review. */
  replyAuthor: "host" | "guest" | null;
  /** What decideItem compares, so a decision is on the words as loaded. */
  version: string;
  propertyId: string;
  propertyName: string;
  bookingId: string;
  /** The review's author (a reply's review): the snapshot the page shows. */
  authorName: string;
  authorCountry: string | null;
  /** First day of the stay's month, YYYY-MM-DD. */
  stayMonth: string;
  /** The review's score, for reviews only. Never part of the decision. */
  score: number | null;
  /** The text as written (null once purged). */
  body: string | null;
  /** The text as the deadline published it, parts masked. */
  maskedBody: string | null;
  fragments: string[];
  rules: ReviewRuleId[];
  /** Reasons the check before 0061 held it for, which aren't rules. */
  otherReasons: string[];
  checkSource: "regex" | "mistral" | "unchecked" | null;
  status: "pending" | "published" | "removed";
  /** When the words were written: a host's edit or a guest's rewrite restarts it. */
  writtenAt: Date;
  /** When a held item publishes masked: writtenAt + MODERATION_DEADLINE_HOURS. */
  deadline: Date;
  publishedAt: Date | null;
  publishedByDeadline: boolean;
  /** A reply's review: whether it is on the page. */
  reviewStatus: string | null;
  /** Whether the author still has an account to email. */
  authorReachable: boolean;
  /**
   * A review only: until when its guest could write it once more after a
   * removal. Null when they couldn't (the rewrite was used, or the window closed).
   */
  rewriteUntil: Date | null;
  rewriteUsed: boolean;
  /** Open reports; on a decided item, the ones its decision closed too. */
  reports: QueueReport[];
  /** Kept, with an open report: it can be decided once more. */
  reopened: boolean;
  decision: {
    decision: "kept" | "removed";
    rules: ReviewRuleId[];
    note: string | null;
    decidedAt: Date;
    /** The moderator's email, or their id when it isn't known. */
    decidedBy: string | null;
  } | null;
};

const HOUR = 3_600_000;
/** The decided tab shows the most recent ones. */
const DECIDED_LIMIT = 100;
/** No tab lists more; the held count in the header says when there are more. */
const QUEUE_LIMIT = 300;

/** Every review and reply still there to moderate or to show as decided: not deleted, nor a reply on a deleted review. */
const ITEMS = `
  SELECT 'review'::text AS kind, rv.id, NULL::text AS reply_author, ${moderationVersionSql("review", "rv")} AS version,
         rv.property_id, rv.booking_id, rv.author_name, rv.author_country, rv.stay_month::text AS stay_month,
         rv.score, rv.body, rv.masked_body, rv.flagged_fragments, rv.flagged_reason, rv.check_source, rv.status,
         rv.created_at AS written_at, rv.published_at, rv.published_by_deadline, NULL::text AS review_status,
         rv.guest_user_id IS NOT NULL AS author_reachable, rv.rewrite_used,
         rv.decision, rv.decision_rules, rv.decision_note, rv.decided_by, rv.decided_at
    FROM reviews rv
   WHERE rv.status IN ('pending', 'published', 'removed')
  UNION ALL
  SELECT 'reply'::text, rr.id, rr.author_role, ${moderationVersionSql("reply", "rr")},
         rv.property_id, rv.booking_id, rv.author_name, rv.author_country, rv.stay_month::text,
         NULL::smallint, rr.body, rr.masked_body, rr.flagged_fragments, rr.flagged_reason, rr.check_source, rr.status,
         COALESCE(rr.edited_at, rr.created_at), rr.published_at, rr.published_by_deadline, rv.status,
         rr.author_user_id IS NOT NULL, false,
         rr.decision, rr.decision_rules, rr.decision_note, rr.decided_by, rr.decided_at
    FROM review_replies rr
    JOIN reviews rv ON rv.id = rr.review_id
   WHERE rr.status IN ('pending', 'published', 'removed') AND rv.status <> 'deleted'`;

/** The item's reports: `i` is the item's alias. */
const reportsOf = (i: string) => `
  (rp.reply_id = ${i}.id OR (${i}.kind = 'review' AND rp.review_id = ${i}.id AND rp.reply_id IS NULL))`;
const OPEN_REPORT = (i: string) => `EXISTS (SELECT 1 FROM review_reports rp WHERE rp.status = 'open' AND ${reportsOf(i)})`;
/** Nobody decided it, or it was kept and has an open report: decideItem decides it (again). */
const OPEN_TO_DECIDE = (i: string) => `(${i}.decided_at IS NULL OR ${OPEN_REPORT(i)})`;

const TAB: Record<ModerationTab, { where: string; order: string; limit: number }> = {
  held: { where: `i.status = 'pending' AND i.decided_at IS NULL`, order: `i.written_at, i.id`, limit: QUEUE_LIMIT },
  reported: {
    where: `${OPEN_TO_DECIDE("i")} AND i.status IN ('pending', 'published') AND ${OPEN_REPORT("i")}`,
    order: `(SELECT min(rp.created_at) FROM review_reports rp WHERE rp.status = 'open' AND ${reportsOf("i")}), i.id`,
    limit: QUEUE_LIMIT,
  },
  deadline: {
    where: `i.status = 'published' AND i.published_by_deadline AND i.decided_at IS NULL`,
    order: `i.published_at, i.id`,
    limit: QUEUE_LIMIT,
  },
  decided: { where: `i.decided_at IS NOT NULL`, order: `i.decided_at DESC, i.id`, limit: DECIDED_LIMIT },
};

type Row = {
  kind: "review" | "reply";
  id: string;
  reply_author: "host" | "guest" | null;
  version: string;
  property_id: string;
  property_name: string;
  booking_id: string;
  author_name: string;
  author_country: string | null;
  stay_month: string;
  score: number | null;
  body: string | null;
  masked_body: string | null;
  flagged_fragments: unknown;
  flagged_reason: string | null;
  check_source: QueueRow["checkSource"];
  status: QueueRow["status"];
  written_at: Date;
  published_at: Date | null;
  published_by_deadline: boolean;
  review_status: string | null;
  author_reachable: boolean;
  rewrite_used: boolean;
  decision: "kept" | "removed" | null;
  decision_rules: string[] | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: Date | null;
  check_out_date: string;
  check_out_time: string | null;
  timezone: string;
  reports: Array<{
    id: string;
    reporter_kind: "host" | "public";
    rule: string;
    note: string | null;
    email_left: boolean;
    status: QueueReport["status"];
    created_at: string;
  }> | null;
};

const rulesOf = (ids: readonly string[]) => [...new Set(ids.filter(isReviewRuleId))];

function toRow(r: Row, now: Date): QueueRow {
  const reasons = (r.flagged_reason ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const fragments = Array.isArray(r.flagged_fragments) ? r.flagged_fragments.filter((f): f is string => typeof f === "string" && f !== "") : [];
  const reports: QueueReport[] = (r.reports ?? [])
    .filter((p) => isReviewRuleId(p.rule))
    .map((p) => ({
      id: p.id,
      reporterKind: p.reporter_kind,
      rule: p.rule as ReviewRuleId,
      note: p.note,
      emailLeft: p.email_left,
      status: p.status,
      createdAt: new Date(p.created_at),
    }));
  const closesAt =
    r.kind === "review"
      ? reviewWindow(projectedCheckOutAt({ checkOutDate: r.check_out_date, checkOutTime: r.check_out_time, timeZone: r.timezone })).closesAt
      : null;
  return {
    kind: r.kind,
    id: r.id,
    replyAuthor: r.reply_author,
    version: r.version,
    propertyId: r.property_id,
    propertyName: r.property_name,
    bookingId: r.booking_id,
    authorName: r.author_name,
    authorCountry: r.author_country?.trim().toUpperCase() || null,
    stayMonth: r.stay_month,
    score: r.score,
    body: r.body,
    maskedBody: r.masked_body,
    fragments,
    rules: rulesOf(reasons),
    otherReasons: reasons.filter((s) => !isReviewRuleId(s)),
    checkSource: r.check_source,
    status: r.status,
    writtenAt: r.written_at,
    deadline: new Date(r.written_at.getTime() + MODERATION_DEADLINE_HOURS * HOUR),
    publishedAt: r.published_at,
    publishedByDeadline: r.published_by_deadline,
    reviewStatus: r.review_status,
    authorReachable: r.author_reachable,
    rewriteUntil: closesAt && !r.rewrite_used && closesAt > now ? closesAt : null,
    rewriteUsed: r.rewrite_used,
    reports,
    reopened: r.decided_at !== null && reports.some((p) => p.status === "open"),
    decision:
      r.decision && r.decided_at
        ? {
            decision: r.decision,
            rules: rulesOf(r.decision_rules ?? []),
            note: r.decision_note,
            decidedAt: r.decided_at,
            decidedBy: r.decided_by_email ?? r.decided_by,
          }
        : null,
  };
}

/** One tab of the queue. Held items oldest first: the nearest deadline on top. */
export async function loadModerationQueue(db: Queryable, tab: ModerationTab, now: Date = new Date()): Promise<QueueRow[]> {
  const t = TAB[tab];
  const { rows } = await db.query(
    `SELECT i.*, p.name AS property_name, b.check_out_date::text AS check_out_date,
            to_char(p.check_out_time, 'HH24:MI') AS check_out_time, p.timezone,
            u.email AS decided_by_email,
            (SELECT json_agg(json_build_object(
                      'id', rp.id, 'reporter_kind', rp.reporter_kind, 'rule', rp.rule, 'note', rp.note,
                      'email_left', rp.reporter_email IS NOT NULL, 'status', rp.status, 'created_at', rp.created_at)
                    ORDER BY rp.created_at)
               FROM review_reports rp
              WHERE ${reportsOf("i")}
                AND (rp.status = 'open' OR (i.decided_at IS NOT NULL AND rp.decided_at = i.decided_at))) AS reports
       FROM (${ITEMS}) i
       JOIN properties p ON p.id = i.property_id
       JOIN bookings b ON b.id = i.booking_id
       LEFT JOIN "user" u ON u.id = i.decided_by
      WHERE ${t.where}
      ORDER BY ${t.order}
      LIMIT ${t.limit}`,
  );
  return (rows as Row[]).map((r) => toRow(r, now));
}

/** How many items wait in each tab that needs a person. */
export async function loadModerationCounts(db: Queryable): Promise<Record<Exclude<ModerationTab, "decided">, number>> {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE ${TAB.held.where})::int AS held,
            count(*) FILTER (WHERE ${TAB.reported.where})::int AS reported,
            count(*) FILTER (WHERE ${TAB.deadline.where})::int AS deadline
       FROM (${ITEMS}) i
      WHERE ${OPEN_TO_DECIDE("i")}`,
  );
  const r = rows[0] as { held: number; reported: number; deadline: number };
  return { held: r.held, reported: r.reported, deadline: r.deadline };
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** What the moderator reads when a decision didn't go through. */
export const DECISION_ERRORS = {
  already_decided: "Already decided",
  changed: "This item changed since you opened it. Reload.",
  not_found: "This item can't be decided any more: its author deleted it, or it isn't held or published.",
  rules_required: "Pick at least one rule.",
} as const;

export type DecisionResult = { ok: true } | { ok: false; error: (typeof DECISION_ERRORS)[keyof typeof DECISION_ERRORS] };

export type DecisionDeps = {
  /** One transaction on the write connection: decideItem is two statements. */
  transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** For the emails, sent after the commit. */
  mail: ReviewSendDeps;
  /** Drops the property's cached public reviews, so the page shows the decision now. */
  purgeReviews: (propertyId: string) => Promise<void>;
  /** Told about every email or purge that failed: none of them fails the decision. */
  report: (error: unknown, context: string) => void;
  now: Date;
};

export type DecisionInput = {
  item: ModerationItem;
  /** The item's version as the queue loaded it (QueueRow.version). */
  version: string;
  /** The moderator's user id. */
  decidedBy: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed item from the browser, or null. */
export function parseItem(item: unknown): ModerationItem | null {
  if (typeof item !== "object" || item === null) return null;
  const { kind, id } = item as { kind?: unknown; id?: unknown };
  if ((kind !== "review" && kind !== "reply") || typeof id !== "string" || !UUID.test(id)) return null;
  return { kind, id };
}

async function decide(
  deps: DecisionDeps,
  i: DecisionInput & { decision: "kept" | "removed"; rules: ReviewRuleId[]; note: string | null },
): Promise<DecisionResult> {
  if (typeof i.version !== "string" || !/^\d+$/.test(i.version)) return { ok: false, error: DECISION_ERRORS.changed };
  const result = await deps.transaction((tx) =>
    decideItem(tx, {
      item: i.item,
      decision: i.decision,
      rules: i.rules,
      note: i.note,
      decidedBy: i.decidedBy,
      now: deps.now,
      version: i.version,
    }),
  );
  // A deleted item comes back not_found, so neither its author nor a reporter hears anything.
  if (!result.ok) return { ok: false, error: DECISION_ERRORS[result.error] };

  const report = (context: string) => (error: unknown) => deps.report(error, context);
  try {
    await deps.purgeReviews(result.propertyId);
  } catch (error) {
    report("purge")(error);
  }
  try {
    // Kept: the author hears nothing; it's as they wrote it.
    if (i.decision === "removed") await sendModerationDecision(i.item, "removed", { report: report("removal notice") }, deps.mail);
    await sendReportOutcomes(result.reportIds, i.decision === "removed", { ...deps.mail, report: report("report outcome") });
  } catch (error) {
    report("emails")(error);
  }
  return { ok: true };
}

/**
 * Keep: the words follow the rules. A held item publishes as written, a
 * deadline-masked one loses its mask, and open reports close as dismissed
 * (their reporters are told). The author gets no email.
 */
export function keepItem(deps: DecisionDeps, i: DecisionInput): Promise<DecisionResult> {
  return decide(deps, { ...i, decision: "kept", rules: [], note: null });
}

/**
 * Remove: at least one rule it broke, and an optional note to the author,
 * shown on their review page (not emailed). The author gets a short email,
 * and open reports close as upheld (their reporters are told).
 */
export function removeItem(deps: DecisionDeps, i: DecisionInput & { rules: string[]; note: string | null }): Promise<DecisionResult> {
  const { rules, note } = removalOf(i.rules, i.note);
  if (rules.length === 0) return Promise.resolve({ ok: false, error: DECISION_ERRORS.rules_required });
  return decide(deps, { ...i, decision: "removed", rules, note });
}

/** The longest note to the author a removal keeps. */
const NOTE_MAX = 1000;

/**
 * What a removal uses from the browser's input: the known rules, once each,
 * and the note trimmed to at most NOTE_MAX characters (null when empty). The
 * audit row records the same.
 */
export function removalOf(rules: unknown, note: unknown): { rules: ReviewRuleId[]; note: string | null } {
  return {
    rules: rulesOf(Array.isArray(rules) ? rules.filter((r): r is string => typeof r === "string") : []),
    note: typeof note === "string" ? note.trim().slice(0, NOTE_MAX) || null : null,
  };
}
