import { bookingReference } from "@openbookings/db/booking-reference";
import { fragmentRanges, MODERATION_RECORD_RETENTION_MONTHS, REVIEW_RULE_IDS, REVIEW_RULES, type ReviewRuleId } from "@openbookings/pricing";
import type { QueueRow } from "./moderation";

/**
 * What the review moderation queue (/reviews) shows for one item, worked out
 * on the server so the card (app/reviews/review-item.tsx, a client
 * component) only renders strings. Free of server imports.
 */

const HOUR = 3_600_000;
/** Under this many hours left, the countdown turns red. */
const URGENT_HOURS = 12;
const ZONE = "Europe/Amsterdam";

export type Rule = { id: ReviewRuleId; title: string };

/** The longest reason for a Keep its audit row keeps (the card's field allows no more). */
export const KEEP_REASON_MAX = 500;

/** Every rule, in the rules page's order, as the Remove picker lists them. */
export const RULE_OPTIONS: Rule[] = REVIEW_RULE_IDS.map((id) => ({ id, title: REVIEW_RULES[id].title }));
const rule = (id: ReviewRuleId): Rule => ({ id, title: REVIEW_RULES[id].title });

export type Segment = { text: string; flagged: boolean };

/**
 * The text cut into plain and flagged pieces, for <mark>: the ranges
 * maskFragments masks (fragmentRanges). Fragments that aren't in the text
 * are ignored.
 */
export function highlightSegments(text: string, fragments: string[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const [s, e] of fragmentRanges(text, fragments)) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), flagged: false });
    out.push({ text: text.slice(s, e), flagged: true });
    cursor = e;
  }
  if (cursor < text.length || out.length === 0) out.push({ text: text.slice(cursor), flagged: false });
  return out;
}

export type Tone = "amber" | "red" | "grey" | "blue" | "green";

export type ItemView = {
  key: string;
  item: { kind: QueueRow["kind"]; id: string };
  version: string;
  kindLabel: string;
  /** Property, then the booking reference (a link), then author and stay: the text around the reference. */
  context: { before: string; after: string };
  bookingId: string;
  bookingRef: string;
  badge: { text: string; tone: Tone } | null;
  /** A line above the text, e.g. why it wasn't checked. */
  explanation: string | null;
  rules: Rule[];
  /** Reasons an earlier check held it for, which aren't rules. */
  otherReasons: string[];
  foundBy: string | null;
  /** The words as written, flagged parts marked; null once purged, or when there were none. */
  text: Segment[] | null;
  /** Instead of `text` when it is null: whether the purge deleted it or there never was one. */
  textNote: string | null;
  /** What the page shows when it differs from the words as written (masked by the deadline). */
  liveText: string | null;
  /** Small and grey: the score, never part of the decision; or the reply's review. */
  footnote: string;
  reports: Array<{ who: "Host" | "Public"; rule: string; note: string | null; extra: string | null }>;
  decision: { label: "Kept" | "Removed"; rules: Rule[]; note: string | null; byline: string } | null;
  /** Null once decided, unless it was kept and reported since. */
  actions: {
    keepLabel: string;
    removeLabel: string;
    remove: {
      title: string;
      summary: string;
      /** For the step-up: "Removing Anna's review of …". */
      removing: string;
      noteLabel: string;
      noteHint: string;
      preselected: ReviewRuleId[];
    };
  } | null;
};

const monthLabel = (isoDate: string) =>
  new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: ZONE });
const moment = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ZONE });

function kindLabel(row: QueueRow): string {
  if (row.kind === "review") return "Review";
  return row.replyAuthor === "host" ? "Reply from the property" : "Guest answer";
}

/** What the item is, as the Remove dialog and the step-up name it. */
function itemName(row: QueueRow): string {
  if (row.kind === "review") return `${row.authorName}'s review of ${row.propertyName}`;
  return row.replyAuthor === "host"
    ? `${row.propertyName}'s reply to ${row.authorName}'s review`
    : `${row.authorName}'s answer to ${row.propertyName}'s reply`;
}

function context(row: QueueRow): ItemView["context"] {
  const author = [row.authorName, row.authorCountry].filter(Boolean).join(", ");
  const stay = `stayed ${monthLabel(row.stayMonth)}`;
  const before = `${row.propertyName} · `;
  if (row.kind === "review") return { before, after: ` · ${author} · ${stay}` };
  return { before, after: ` · on ${author}'s review (${stay})` };
}

function foundBy(row: QueueRow): string | null {
  switch (row.checkSource) {
    case "regex":
      return row.rules.length > 0 ? "Found by the contact check" : null;
    case "mistral":
      return row.rules.length > 0 ? "Found by the contact check and Mistral" : null;
    case "unchecked":
      return row.rules.length > 0 ? "Found by the contact check · Mistral hasn't checked it yet" : "Not checked yet";
    default:
      return row.rules.length + row.otherReasons.length > 0 ? "Held by the earlier check" : null;
  }
}

/** Hours left until `at`, rounded up. */
const hoursLeft = (at: Date, now: Date) => Math.ceil((at.getTime() - now.getTime()) / HOUR);

function heldBadge(row: QueueRow, now: Date): { badge: ItemView["badge"]; explanation: string | null } {
  const left = hoursLeft(row.deadline, now);
  const masks = row.fragments.length > 0;
  const when = left <= 1 ? "within the hour" : `in ${left} h`;
  const tone: Tone = left <= URGENT_HOURS ? "red" : "amber";
  if (row.checkSource === "unchecked") {
    const found =
      row.rules.length > 0 ? "The contact check found the marked parts." : "Nothing was found by the contact check.";
    const after = !row.deadlineMay
      ? "It waits for you: it was held before the new check, which hasn't run on it yet."
      : left > 0
        ? `It publishes on its own once a check passes, or ${masks ? "with the marked parts masked" : "as written"} ${when}. You can decide now.`
        : "It publishes at the next run of the moderation job. You can decide now.";
    return {
      badge: { text: "Not checked yet · retrying every 15 min", tone: "grey" },
      explanation: `The automatic check couldn't run (Mistral didn't answer). ${found} ${after}`,
    };
  }
  if (!row.deadlineMay && row.checkSource !== null) {
    return {
      badge: { text: "Needs a person: the flagged words couldn't be pinpointed", tone: left <= URGENT_HOURS ? "red" : "amber" },
      explanation:
        "The check says it breaks a rule but couldn't say which words, so there is nothing to mask. It won't publish on its own at the deadline: it waits for you.",
    };
  }
  if (!row.deadlineMay || left <= 0) return { badge: { text: "Past the deadline · waits for you", tone: "red" }, explanation: null };
  return { badge: { text: `Publishes ${masks ? "masked" : "as written"} ${when}`, tone }, explanation: null };
}

function badge(row: QueueRow, now: Date): { badge: ItemView["badge"]; explanation: string | null } {
  if (row.reopened) {
    return {
      badge: { text: "Kept · reported again", tone: "amber" },
      explanation: "It was kept, then reported again. It stays live while you decide once more.",
    };
  }
  if (row.decision) {
    return { badge: row.decision.decision === "kept" ? { text: "Kept", tone: "green" } : { text: "Removed", tone: "red" }, explanation: null };
  }
  if (row.status === "pending") return heldBadge(row, now);
  if (row.publishedByDeadline && row.maskedBody !== null) {
    return { badge: { text: `Live with parts masked since ${dayLabel(row.publishedAt ?? row.deadline)}`, tone: "amber" }, explanation: null };
  }
  if (row.publishedByDeadline) {
    return { badge: { text: `Live as written since ${dayLabel(row.publishedAt ?? row.deadline)}`, tone: "amber" }, explanation: null };
  }
  return { badge: { text: "Live while you look", tone: "blue" }, explanation: null };
}

function removeSummary(row: QueueRow): string {
  const parts: string[] = [];
  const shown = row.status === "published";
  if (row.kind === "review") parts.push(shown ? "It disappears from the property page." : "It never appears on the property page.");
  else parts.push(shown ? "It disappears from the review's thread." : "It never appears in the review's thread.");

  const host = row.kind === "reply" && row.replyAuthor === "host";
  if (!row.authorReachable) parts.push("Its author's account is gone, so nobody is emailed.");
  else if (host) parts.push("The property gets a short email that it was removed; its Reviews page shows the rules it broke and your note.");
  else parts.push(`${row.authorName} gets a short email that it was removed; the review page shows the rules it broke and your note.`);

  if (row.kind === "review") {
    if (row.rewriteUntil) parts.push(`${row.authorName} can write it once more before ${dayLabel(row.rewriteUntil)}.`);
    else if (row.rewriteUsed) parts.push(`This was ${row.authorName}'s second try, so it can't be written again.`);
    else parts.push("The review window has closed, so it can't be written again.");
  }

  const open = row.reports.filter((r) => r.status === "open").length;
  if (open === 1) parts.push("Its open report closes as upheld.");
  else if (open > 1) parts.push(`Its ${open} open reports close as upheld.`);
  return parts.join(" ");
}

function footnote(row: QueueRow): string {
  if (row.kind === "review") return `Score ${row.score ?? "–"}/10 · not part of the decision`;
  const review = row.reviewStatus === "published" ? "live" : row.reviewStatus === "pending" ? "held" : row.reviewStatus;
  return `Reply · the review it answers is ${review}`;
}

/** One item of the queue, ready to render at `now`. */
export function itemView(row: QueueRow, now: Date): ItemView {
  const { badge: b, explanation } = badge(row, now);
  const masked = row.maskedBody !== null && row.maskedBody !== row.body && !row.decision;
  const openReports = row.reports.filter((r) => r.status === "open").length > 0;
  const host = row.kind === "reply" && row.replyAuthor === "host";
  return {
    key: `${row.kind}:${row.id}`,
    item: { kind: row.kind, id: row.id },
    version: row.version,
    kindLabel: kindLabel(row),
    context: context(row),
    bookingId: row.bookingId,
    bookingRef: bookingReference(row.bookingId),
    badge: b,
    explanation,
    rules: row.decision ? [] : row.rules.map(rule),
    otherReasons: row.decision ? [] : row.otherReasons,
    foundBy: row.decision ? null : foundBy(row),
    text: row.body === null ? null : highlightSegments(row.body, row.decision ? [] : row.fragments),
    textNote:
      row.body !== null
        ? null
        : row.textPurged
          ? `The text was deleted ${MODERATION_RECORD_RETENTION_MONTHS} months after the decision.`
          : "No text: a score only.",
    liveText: masked ? row.maskedBody : null,
    footnote: footnote(row),
    reports: row.reports.map((r) => ({
      who: r.reporterKind === "host" ? "Host" : "Public",
      rule: REVIEW_RULES[r.rule].title,
      note: r.note,
      extra: [
        r.reporterKind === "public" && !r.note ? "no note" : null,
        r.reporterKind === "public" ? (r.emailLeft ? "email left for the outcome" : "no email left") : null,
        r.status !== "open" ? r.status : null,
      ]
        .filter(Boolean)
        .join(", ") || null,
    })),
    decision: row.decision
      ? {
          label: row.decision.decision === "kept" ? "Kept" : "Removed",
          rules: row.decision.rules.map(rule),
          note: row.decision.note,
          byline: `${row.decision.decidedBy ?? "Unknown"} · ${moment(row.decision.decidedAt)}`,
        }
      : null,
    actions:
      row.decision && !row.reopened
        ? null
        : {
          keepLabel: openReports ? "Keep · dismiss reports" : "Keep as written",
          removeLabel: openReports ? "Remove · uphold…" : "Remove…",
          remove: {
            title: `Remove ${itemName(row)}?`,
            summary: removeSummary(row),
            removing: `Removing ${itemName(row)}`,
            noteLabel: host ? "Note to the property" : `Note to ${row.authorName}`,
            noteHint: host ? "optional, shown on its Reviews page" : "optional, shown on the review page",
            preselected: [...new Set([...row.rules, ...row.reports.filter((r) => r.status === "open").map((r) => r.rule)])],
          },
        },
  };
}

export const TAB_LABELS = {
  held: "Held",
  reported: "Reported",
  deadline: "Published by deadline",
  decided: "Decided",
} as const;
