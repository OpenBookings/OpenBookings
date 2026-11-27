import { describe, expect, test } from 'bun:test';
import { REVIEW_RULES, type AuthorModeration } from '@openbookings/pricing';
import { bookingReference } from '@openbookings/db/booking-reference';
import { guestNotice } from './author-notice';

const BOOKING = '3f1c2a9e-5b7d-4c11-9a2e-7d1f0b6c8e42';
const NOW = new Date('2026-11-21T09:00:00Z');
const OPEN = { ok: true as const, closesAt: new Date('2026-12-26T12:00:00Z') };

const base: AuthorModeration = {
  written: 'Lovely stay. Call Jan on 0612345678.',
  flaggedRules: ['links_contact'],
  decision: null,
  decisionRules: [],
  decisionNote: null,
  decidedAt: null,
  publishedByDeadline: false,
  maskedBody: null,
  textPurged: false,
  deadlineMay: true,
  heldSince: '2026-11-20T10:00:00.000Z',
};
const removed: AuthorModeration = {
  ...base,
  decision: 'removed',
  decisionRules: ['links_contact', 'abuse'],
  decisionNote: "Your review can mention the staff, but not insult them.",
  decidedAt: '2026-11-28T10:00:00.000Z',
};
const masked: AuthorModeration = { ...base, publishedByDeadline: true, maskedBody: 'Lovely stay. Call Jan on [removed].' };

const notice = (over: Partial<Parameters<typeof guestNotice>[0]>) =>
  guestNotice({
    kind: 'review',
    status: 'published',
    moderation: base,
    bookingId: BOOKING,
    timeZone: 'Europe/Amsterdam',
    eligibility: { ok: false, reason: 'already_reviewed' },
    now: NOW,
    ...over,
  });

const objection = (subject: string) => ({
  href: `mailto:support@openbookings.co?subject=${encodeURIComponent(subject)}`,
});

describe('guestNotice', () => {
  test('held: waiting for a person, and when it publishes masked if nobody has, in the property’s time', () => {
    for (const kind of ['review', 'answer'] as const) {
      expect(notice({ kind, status: 'pending' })).toEqual({
        state: 'held',
        text: 'Waiting for a person to check it. If nobody has by 23 Nov 2026, 11:00 CET, it publishes with the flagged parts replaced by [removed].',
      });
    }
  });

  test('held past its deadline (waiting for a recheck): no date in the past', () => {
    expect(notice({ status: 'pending', now: new Date('2026-11-24T09:00:00Z') })).toEqual({
      state: 'held',
      text: "Waiting for a person to check it. It isn't shown yet.",
    });
  });

  test("held, but the deadline can't publish it (the flagged words couldn't be pinpointed): no deadline promised", () => {
    for (const kind of ['review', 'answer'] as const) {
      expect(notice({ kind, status: 'pending', moderation: { ...base, deadlineMay: false } })).toEqual({
        state: 'held',
        text: "A person will check it before it's shown.",
      });
    }
  });

  test('removed review, rewrite open: who and when, the rules, the note, how to object, and the one rewrite', () => {
    expect(notice({ status: 'removed', moderation: removed, eligibility: OPEN })).toEqual({
      state: 'removed',
      pill: 'Removed',
      byline: 'by a person at OpenBookings on 28 Nov 2026',
      lead: 'Your review broke these',
      rules: [REVIEW_RULES.links_contact, REVIEW_RULES.abuse],
      note: "Your review can mention the staff, but not insult them.",
      written: { text: 'Lovely stay. Call Jan on 0612345678.', placeholder: false },
      objection: objection(`Review decision, booking ${bookingReference(BOOKING)}`),
      rewrite: {
        open: true,
        title: 'You can write your review once more',
        detail: "Until 26 Dec 2026. If this one is removed too, the stay can't be reviewed again.",
      },
    });
  });

  test('removed, its text purged after 12 months: nothing to show of what they wrote', () => {
    expect(notice({ status: 'removed', moderation: { ...removed, written: null, textPurged: true }, eligibility: OPEN })).toMatchObject({
      written: { text: 'The text was deleted after 12 months.', placeholder: true },
    });
  });

  test('removed score-only review: it never had a text, so nothing was deleted', () => {
    expect(notice({ status: 'removed', moderation: { ...removed, written: null, textPurged: false }, eligibility: OPEN })).toMatchObject({
      written: { text: 'You gave a score only, without a text.', placeholder: true },
    });
  });

  test('removed review without a note: no note', () => {
    expect(notice({ status: 'removed', moderation: { ...removed, decisionNote: null }, eligibility: OPEN })).toMatchObject({
      state: 'removed',
      note: null,
    });
  });

  test('removed review, rewrite used: it says the stay can’t be reviewed again', () => {
    expect(notice({ status: 'removed', moderation: removed, eligibility: { ok: false, reason: 'already_reviewed' } })).toMatchObject({
      rewrite: { open: false, detail: "It was already written once more, so this stay can't be reviewed again." },
    });
  });

  test('removed review, window closed: it says the time to write it again has passed', () => {
    expect(notice({ status: 'removed', moderation: removed, eligibility: { ok: false, reason: 'window_closed' } })).toMatchObject({
      rewrite: { open: false, detail: "Reviews can be written up to 30 days after check-out, so it can't be written again." },
    });
  });

  test('removed before decisions were recorded: no date, no rule list', () => {
    expect(notice({ status: 'removed', moderation: base, eligibility: OPEN })).toMatchObject({
      byline: 'by a person at OpenBookings',
      lead: 'Your review broke our',
      rules: [],
      note: null,
    });
  });

  test('removed answer: the same, without a rewrite', () => {
    expect(notice({ kind: 'answer', status: 'removed', moderation: removed, eligibility: undefined })).toEqual({
      state: 'removed',
      pill: 'Removed',
      byline: 'by a person at OpenBookings on 28 Nov 2026',
      lead: 'Your answer broke these',
      rules: [REVIEW_RULES.links_contact, REVIEW_RULES.abuse],
      note: "Your review can mention the staff, but not insult them.",
      written: { text: 'Lovely stay. Call Jan on 0612345678.', placeholder: false },
      objection: objection(`Answer decision, booking ${bookingReference(BOOKING)}`),
      rewrite: null,
    });
  });

  test("published with parts removed: automatic, the check's rules, the published text and what they wrote", () => {
    for (const [kind, noun] of [['review', 'Review'], ['answer', 'Answer']] as const) {
      expect(notice({ kind, status: 'published', moderation: masked })).toEqual({
        state: 'masked',
        pill: 'Published with parts removed',
        automatic: 'This happened automatically after 72 hours because nobody had checked it yet.',
        lead: 'The parts replaced by [removed] seemed to break these',
        rules: [REVIEW_RULES.links_contact],
        published: 'Lovely stay. Call Jan on [removed].',
        written: 'Lovely stay. Call Jan on 0612345678.',
        objection: objection(`${noun} decision, booking ${bookingReference(BOOKING)}`),
      });
    }
  });

  test('published as written, or kept: nothing extra', () => {
    expect(notice({ status: 'published' })).toBeNull();
    expect(notice({ status: 'published', moderation: { ...masked, decision: 'kept', maskedBody: null } })).toBeNull();
    expect(notice({ kind: 'answer', status: 'published', moderation: { ...base, decision: 'kept' } })).toBeNull();
  });
});
