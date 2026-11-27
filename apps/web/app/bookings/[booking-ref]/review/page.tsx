import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@openbookings/db';
import { getReviewContext } from '@openbookings/db/reviews';
import { getServerSession } from '@/lib/auth';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { nextReplyRole } from '@openbookings/pricing';
import { DeleteReviewButton } from '@/app/review/_components/ReviewActions';
import { ReplyAnswerForm } from '@/app/review/_components/ReplyAnswerForm';
import { ReviewForm } from '@/app/review/_components/ReviewForm';
import { formatStayMonth, ReviewShell } from '@/app/review/_components/ReviewShell';
import { removedReview } from '@/app/review/_lib/removed-review';
import { guestNotice } from '@/app/review/_lib/author-notice';
import { ModerationNotice } from '@/app/review/_components/ModerationNotice';

export const metadata: Metadata = { title: 'Your review' };
export const dynamic = 'force-dynamic';

const CLOSED: Record<string, string> = {
  too_early: 'You can review this stay from 24 hours after check-out.',
  window_closed: 'Reviews can be written up to 30 days after check-out. This one has closed.',
  no_show: 'Only stays that took place can be reviewed.',
  not_stayed: 'Only stays that took place can be reviewed.',
};

/** When moderation has nothing to say (guestNotice): published as written or kept, or hidden. */
const STATUS: Record<string, string> = {
  published: 'Posted on the property page.',
  hidden: 'Hidden by OpenBookings. Email support@openbookings.co to object.',
};

/**
 * The signed-in guest's review of one booking: write it, see it, delete it.
 * After moderation it says what happened (held, removed, or published with
 * parts removed: guestNotice), for the review and for their own answer under
 * it. A removed review may be written once more (`?write=1` opens the form).
 */
export default async function BookingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-ref': string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { 'booking-ref': bookingId } = await params;
  const { write } = await searchParams;
  const session = await getServerSession();

  if (!session) {
    return (
      <ReviewShell title="Sign in to review your stay">
        <AuthFormPhaseProvider>
          <AuthFormFields callbackURL={`/bookings/${encodeURIComponent(bookingId)}/review`} />
        </AuthFormPhaseProvider>
      </ReviewShell>
    );
  }

  const now = new Date();
  const context = await getReviewContext(getPool(), bookingId, now);
  if (!context || context.guestUserId !== session.user.id) notFound();
  const eyebrow = `${context.propertyName} · ${formatStayMonth(context.stayMonth)}`;
  const back = (
    <Link href={`/bookings/${bookingId}`} className="text-sm text-white/70 underline underline-offset-4 hover:text-white">
      Back to your booking
    </Link>
  );

  const removed = removedReview(context);
  if (removed?.canRewrite && write === '1') {
    return (
      <ReviewShell eyebrow={eyebrow} title="How was your stay?">
        <p className="mb-6 text-sm text-white/65">{removed.message}</p>
        <ReviewForm proof={{ kind: 'session', bookingId }} propertyName={context.propertyName} />
      </ReviewShell>
    );
  }

  if (context.review) {
    const { review } = context;
    const notice = guestNotice({
      kind: 'review',
      status: review.status,
      moderation: review.moderation,
      bookingId,
      timeZone: context.timeZone,
      eligibility: context.eligibility,
      now,
    });
    const actions = (
      <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
        <DeleteReviewButton bookingId={bookingId} />
        {back}
      </div>
    );
    if (review.status === 'deleted') {
      return (
        <ReviewShell eyebrow={eyebrow} title="Review deleted">
          <div className="flex flex-col gap-4">
            <p className="text-[15px] text-white/75">You deleted your review of this stay. A stay can only be reviewed once.</p>
            {back}
          </div>
        </ReviewShell>
      );
    }
    // Removed: what happened and why, and the one rewrite; the words are no longer shown.
    if (notice?.state === 'removed') {
      const { rewrite } = notice;
      return (
        <ReviewShell eyebrow={eyebrow} title="Your review">
          <div className="flex flex-col gap-5">
            <ModerationNotice notice={notice} />
            {rewrite?.open ? (
              <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-4 sm:px-5">
                <span className="font-semibold text-white">{rewrite.title}</span>
                <span className="text-[13px] text-white/60">{rewrite.detail}</span>
                <Link
                  href={`/bookings/${bookingId}/review?write=1`}
                  className="self-end rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                >
                  Write it again
                </Link>
              </section>
            ) : rewrite ? (
              <p className="text-sm text-white/55">{rewrite.detail}</p>
            ) : null}
            {actions}
          </div>
        </ReviewShell>
      );
    }
    return (
      <ReviewShell eyebrow={eyebrow} title="Your review">
        <div className="flex flex-col gap-5">
          <p className="font-serif text-5xl leading-none tabular-nums">
            {review.score}
            <span className="text-2xl text-white/45"> / 10</span>
          </p>
          {/* Published with parts removed: the text as published; their own words are in the notice. */}
          {notice?.state === 'masked' ? (
            <p className="text-[15px] whitespace-pre-line text-white/85">{notice.published}</p>
          ) : review.body ? (
            <p className="text-[15px] whitespace-pre-line text-white/85">{review.body}</p>
          ) : null}
          {notice ? <ModerationNotice notice={notice} /> : <p className="text-sm text-white/55">{STATUS[review.status] ?? ''}</p>}
          {review.replies.length > 0 ? (
            <div className="flex flex-col gap-4 border-t border-white/10 pt-5">
              {review.replies.map((r) => {
                const answer = r.moderation
                  ? guestNotice({ kind: 'answer', status: r.status, moderation: r.moderation, bookingId, timeZone: context.timeZone, now })
                  : null;
                return (
                  <div key={r.id} className={`flex flex-col gap-1.5 border-l border-white/15 pl-4 ${r.role === 'guest' ? 'ml-4' : ''}`}>
                    <p className="text-xs text-white/55">
                      <span className="font-medium text-white/85">
                        {r.role === 'host' ? `Response from ${context.propertyName}` : 'Your answer'}
                      </span>
                      {r.editedAt ? ' · Edited' : ''}
                    </p>
                    {/* A removed answer's words are no longer shown; a masked one shows as published. */}
                    {answer?.state === 'removed' ? null : <p className="text-[15px] whitespace-pre-line text-white/85">{r.body}</p>}
                    {answer ? <ModerationNotice notice={answer} /> : null}
                  </div>
                );
              })}
              {review.status === 'published' && nextReplyRole(review.replies.map((r) => r.role)) === 'guest' ? (
                <ReplyAnswerForm bookingId={bookingId} propertyName={context.propertyName} />
              ) : null}
            </div>
          ) : null}
          {actions}
        </div>
      </ReviewShell>
    );
  }

  if (!context.eligibility.ok) {
    return (
      <ReviewShell eyebrow={eyebrow} title="Can't review this stay">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-white/75">{CLOSED[context.eligibility.reason] ?? 'This stay cannot be reviewed.'}</p>
          {back}
        </div>
      </ReviewShell>
    );
  }

  return (
    <ReviewShell eyebrow={eyebrow} title="How was your stay?">
      <ReviewForm proof={{ kind: 'session', bookingId }} propertyName={context.propertyName} />
    </ReviewShell>
  );
}
