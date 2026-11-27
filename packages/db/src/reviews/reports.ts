/**
 * Reports (0061): a host, or anyone on the property page, reports a published
 * review or reply against one rule. A report never holds or hides anything:
 * the item stays visible until a moderator decides it (decideItem, which
 * closes its reports). One open report per reporter per item (the unique
 * index): a host by its organization, a member of the public by the email
 * they left or their account.
 *
 * Callers prove who is reporting: the business app checks the member can
 * see the property, the guest site runs Turnstile and an IP rate limit. This
 * module only decides whether the item can be reported, and stores it.
 *
 * Under the app roles a public reporter may insert a report but never read
 * one back (ob_app_public_insert has no SELECT side), so no statement here
 * uses RETURNING on review_reports: the id is made here, and a lost insert
 * is told apart by the row count.
 */
import { isReviewRuleId } from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";
import type { ModerationItem } from "./moderation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The note column's CHECK limit (0061). */
export const REPORT_NOTE_MAX = 1000;

export type ReportReporter =
  /** A member of the property's team; the organization is the property's. */
  | { kind: "host"; userId: string }
  /**
   * Anyone on the property page. `userId` when signed in; `email` only when
   * they asked for updates (their account's address at report time, never a
   * typed one), else null and nobody is told the outcome.
   */
  | { kind: "public"; userId: string | null; email: string | null };

export type CreateReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: "not_found" | "already_open" | "invalid" };

/** What a report form shows of the item: published words only, masked where the deadline masked them. */
export type ReportTarget = {
  item: ModerationItem;
  reviewId: string;
  propertyId: string;
  propertyName: string;
  /** The property page's slug: the form lives under it. */
  propertySlug: string;
  /** The review's author: first name, country, stay month (YYYY-MM-01). */
  authorName: string;
  authorCountry: string | null;
  stayMonth: string;
  /** A reply's author, null for a review. */
  replyRole: "host" | "guest" | null;
  /** The text as the property page shows it; null for a score without words. */
  body: string | null;
};

type TargetRow = {
  review_id: string;
  property_id: string;
  property_name: string;
  property_slug: string;
  organization_id: string | null;
  author_name: string;
  author_country: string | null;
  stay_month: string;
  reply_role: "host" | "guest" | null;
  body: string | null;
};

/**
 * The item when it is published, on a published review: the only things
 * anyone can report. A reply's review comes from the reply, never from the
 * caller. Null for anything else (held, removed, deleted, hidden, unknown).
 */
async function publishedTarget(db: Queryable, item: ModerationItem): Promise<TargetRow | null> {
  if ((item.kind !== "review" && item.kind !== "reply") || !UUID.test(item.id)) return null;
  const { rows } =
    item.kind === "review"
      ? await db.query(
          `SELECT rv.id AS review_id, rv.property_id, p.name AS property_name, p.slug AS property_slug, p.organization_id,
                  rv.author_name, rv.author_country, rv.stay_month::text AS stay_month,
                  NULL::text AS reply_role, COALESCE(rv.masked_body, rv.body) AS body
             FROM reviews rv JOIN properties p ON p.id = rv.property_id
            WHERE rv.id = $1::uuid AND rv.status = 'published'`,
          [item.id],
        )
      : await db.query(
          `SELECT rv.id AS review_id, rv.property_id, p.name AS property_name, p.slug AS property_slug, p.organization_id,
                  rv.author_name, rv.author_country, rv.stay_month::text AS stay_month,
                  rr.author_role AS reply_role, COALESCE(rr.masked_body, rr.body) AS body
             FROM review_replies rr
             JOIN reviews rv ON rv.id = rr.review_id
             JOIN properties p ON p.id = rv.property_id
            WHERE rr.id = $1::uuid AND rr.status = 'published' AND rv.status = 'published'`,
          [item.id],
        );
  return (rows[0] as TargetRow | undefined) ?? null;
}

/** The item a report form is about, or null when it can't be reported. */
export async function loadReportTarget(db: Queryable, item: ModerationItem): Promise<ReportTarget | null> {
  const row = await publishedTarget(db, item);
  if (!row) return null;
  return {
    item: { kind: item.kind, id: item.id },
    reviewId: row.review_id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    propertySlug: row.property_slug,
    authorName: row.author_name,
    authorCountry: row.author_country?.trim().toUpperCase() || null,
    stayMonth: row.stay_month,
    replyRole: row.reply_role,
    body: row.body,
  };
}

/** A trimmed note, null when empty; undefined when it is too long or not text. */
function reportNote(note: unknown): string | null | undefined {
  if (note === null || note === undefined) return null;
  if (typeof note !== "string") return undefined;
  const text = note.trim();
  if (text.length > REPORT_NOTE_MAX) return undefined;
  return text || null;
}

/**
 * Stores a report on a published review or reply. A second open report from
 * the same reporter on the same item is `already_open`; a held, removed or
 * deleted item is `not_found`; an unknown rule, a note over REPORT_NOTE_MAX
 * or a malformed email is `invalid`. A host reports reviews and guests'
 * answers, never a property's reply (its own, or a colleague's): `invalid`.
 *
 * A kept item reported again opens again for a moderator (decideItem).
 */
export async function createReviewReport(
  db: Queryable,
  i: { item: ModerationItem; reporter: ReportReporter; rule: unknown; note: unknown; now: Date },
): Promise<CreateReportResult> {
  const note = reportNote(i.note);
  if (!isReviewRuleId(i.rule) || note === undefined) return { ok: false, error: "invalid" };
  const reporter = i.reporter;
  if (reporter.kind === "host" ? !reporter.userId : reporter.email !== null && !/^[^\s@]+@[^\s@]+$/.test(reporter.email)) {
    return { ok: false, error: "invalid" };
  }

  const target = await publishedTarget(db, i.item);
  if (!target) return { ok: false, error: "not_found" };
  if (reporter.kind === "host" && target.reply_role === "host") return { ok: false, error: "invalid" };

  const id = crypto.randomUUID();
  const result = (await db.query(
    `INSERT INTO review_reports (id, review_id, reply_id, reporter_kind, reporter_user_id, reporter_org_id, reporter_email, rule, note, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING`,
    [
      id,
      target.review_id,
      i.item.kind === "reply" ? i.item.id : null,
      reporter.kind,
      reporter.userId,
      reporter.kind === "host" ? target.organization_id : null,
      reporter.kind === "public" ? reporter.email : null,
      i.rule,
      note,
      i.now,
    ],
  )) as { rowCount?: number | null };
  // The only conflict is the one-open-report-per-reporter index.
  if (result.rowCount === 0) return { ok: false, error: "already_open" };
  return { ok: true, reportId: id };
}
