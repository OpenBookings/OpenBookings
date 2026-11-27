import {
  authorNotice,
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  REVIEW_RULES,
  type AuthorModeration,
} from "@openbookings/pricing";
import { bookingReference } from "@openbookings/db/booking-reference";
import type { ReplyStatus } from "@openbookings/db/reviews";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * What the Reviews page says about the host's own public reply after
 * moderation (Host Agreement 6.5, /legal/review-rules §5): held for a person
 * until the deadline; removed by a person, with the rules and the note; or
 * published by the deadline with parts replaced, automatically. Published as
 * written, or kept: nothing. The way to object is support@openbookings.co (or
 * replying to the email).
 */
export type HostReplyNotice =
  | { state: "held"; pill: "Being checked"; tone: StatusTone; line: string }
  | {
      state: "removed" | "masked";
      pill: "Removed" | "Published with parts removed";
      tone: StatusTone;
      line: string;
      rules: { title: string; description: string }[];
      note: string | null;
      /** Masked only: the reply as the host wrote it (the page shows it as published). */
      written: string | null;
      /** mailto: support, with a subject naming the booking. */
      objection: string;
    };

const day = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
const time = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short", timeZone });

export function hostReplyNotice(i: {
  status: ReplyStatus;
  moderation: AuthorModeration;
  bookingId: string;
  /** The property's: dates are its local dates. */
  timeZone: string;
  now: Date;
}): HostReplyNotice | null {
  const notice = authorNotice(i.status, i.moderation);
  if (!notice) return null;
  if (notice.state === "held") {
    const { deadline } = notice;
    return {
      state: "held",
      pill: "Being checked",
      tone: "attention",
      line:
        deadline > i.now
          ? `Waiting for a person to check it. If nobody has by ${day(i.timeZone).format(deadline)}, ${time(i.timeZone).format(deadline)}, it publishes with the flagged parts replaced by ${MASKED_TEXT}.`
          : "Waiting for a person to check it. It isn't public yet.",
    };
  }
  const shared = {
    rules: notice.rules.map((id) => REVIEW_RULES[id]),
    objection: `mailto:support@openbookings.co?subject=${encodeURIComponent(`Reply decision, booking ${bookingReference(i.bookingId)}`)}`,
  };
  if (notice.state === "removed") {
    return {
      state: "removed",
      pill: "Removed",
      tone: "stopped",
      line: `Removed by a person at OpenBookings${notice.decidedAt ? ` on ${day(i.timeZone).format(notice.decidedAt)}` : ""}. It's no longer on your page.`,
      note: notice.note,
      written: null,
      ...shared,
    };
  }
  return {
    state: "masked",
    pill: "Published with parts removed",
    tone: "attention",
    line: `Published automatically after ${MODERATION_DEADLINE_HOURS} hours, because nobody had checked it yet. The parts that seemed to break a rule show as ${MASKED_TEXT}.`,
    note: null,
    written: notice.written,
    ...shared,
  };
}
