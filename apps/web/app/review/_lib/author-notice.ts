import {
  authorNotice,
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  REVIEW_RULES,
  type AuthorModeration,
  type ReviewEligibility,
} from '@openbookings/pricing';
import { bookingReference } from '@openbookings/db/booking-reference';
import type { ReplyStatus, ReviewStatus } from '@openbookings/db/reviews';
import { rewriteOf } from './removed-review';

/**
 * What the guest's review page says about their own review, or their own
 * answer in its thread, after moderation (Terms 10.12, /legal/review-rules §5):
 * held for a person until the deadline; removed by a person, with the rules,
 * the note and the one rewrite; or published by the deadline with parts
 * replaced, automatically. Published as written, or kept: nothing.
 */

type Rule = { title: string; description: string };
type Objection = { href: string };

export type GuestNotice =
  | { state: 'held'; text: string }
  | {
      state: 'removed';
      pill: 'Removed';
      byline: string;
      /** Followed by a link to the review rules, then ":" before `rules`, or "." when there are none. */
      lead: string;
      rules: Rule[];
      note: string | null;
      objection: Objection;
      /** Only for a review: whether it may be written once more. */
      rewrite: { open: true; title: string; detail: string } | { open: false; detail: string } | null;
    }
  | {
      state: 'masked';
      pill: 'Published with parts removed';
      automatic: string;
      lead: string;
      rules: Rule[];
      /** As published: the flagged parts replaced. */
      published: string;
      /** What they wrote: their own words, shown only to them. */
      written: string | null;
      objection: Objection;
    };

const NOUN = { review: 'review', answer: 'answer' } as const;

const day = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
const time = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short', timeZone });
/** "23 Nov 2026, 11:00 CET" (built from two parts: one format's joining word differs between runtimes). */
const dayTime = (d: Date, timeZone: string) => `${day(timeZone).format(d)}, ${time(timeZone).format(d)}`;

/** support@openbookings.co, with a subject naming the booking (reply to the email is the other way). */
const objectionFor = (kind: keyof typeof NOUN, bookingId: string): Objection => ({
  href: `mailto:support@openbookings.co?subject=${encodeURIComponent(
    `${kind === 'review' ? 'Review' : 'Answer'} decision, booking ${bookingReference(bookingId)}`,
  )}`,
});

export function guestNotice(i: {
  kind: keyof typeof NOUN;
  status: ReviewStatus | ReplyStatus;
  moderation: AuthorModeration;
  bookingId: string;
  /** The property's: the deadline is shown in its local time. */
  timeZone: string;
  /** For a review: whether a removed one may be written once more. */
  eligibility?: ReviewEligibility;
  now: Date;
}): GuestNotice | null {
  const notice = authorNotice(i.status, i.moderation);
  if (!notice) return null;
  const noun = NOUN[i.kind];
  const rules = notice.state === 'held' ? [] : notice.rules.map((id) => REVIEW_RULES[id]);
  const lead = (start: string) => `${start} ${rules.length > 0 ? 'these' : 'our'}`;

  switch (notice.state) {
    case 'held':
      return {
        state: 'held',
        text:
          notice.deadline > i.now
            ? `Waiting for a person to check it. If nobody has by ${dayTime(notice.deadline, i.timeZone)}, it publishes with the flagged parts replaced by ${MASKED_TEXT}.`
            : "Waiting for a person to check it. It isn't shown yet.",
      };
    case 'removed': {
      const rewrite = i.kind === 'review' && i.eligibility ? rewriteOf(i.eligibility) : null;
      return {
        state: 'removed',
        pill: 'Removed',
        byline: notice.decidedAt
          ? `by a person at OpenBookings on ${day(i.timeZone).format(notice.decidedAt)}`
          : 'by a person at OpenBookings',
        lead: lead(`Your ${noun} broke`),
        rules,
        note: notice.note,
        objection: objectionFor(i.kind, i.bookingId),
        rewrite: !rewrite
          ? null
          : rewrite.open
            ? {
                open: true,
                title: 'You can write your review once more',
                detail: `Until ${day(i.timeZone).format(rewrite.until)}. If this one is removed too, the stay can't be reviewed again.`,
              }
            : { open: false, detail: rewrite.reason },
      };
    }
    case 'masked':
      return {
        state: 'masked',
        pill: 'Published with parts removed',
        automatic: `This happened automatically after ${MODERATION_DEADLINE_HOURS} hours because nobody had checked it yet.`,
        lead: lead(`The parts replaced by ${MASKED_TEXT} seemed to break`),
        rules,
        published: notice.published,
        written: notice.written,
        objection: objectionFor(i.kind, i.bookingId),
      };
  }
}
