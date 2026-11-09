import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@openbookings/db';
import { getReviewContext } from '@openbookings/db/reviews';
import { getServerSession } from '@/lib/auth';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { DeleteReviewButton } from '@/app/review/_components/ReviewActions';
import { ReviewForm } from '@/app/review/_components/ReviewForm';
import { formatStayMonth, ReviewShell } from '@/app/review/_components/ReviewShell';

export const metadata: Metadata = { title: 'Your review' };
export const dynamic = 'force-dynamic';

const CLOSED: Record<string, string> = {
  too_early: 'You can review this stay from 24 hours after check-out.',
  window_closed: 'Reviews can be written up to 30 days after check-out. This one has closed.',
  no_show: 'Only stays that took place can be reviewed.',
  not_stayed: 'Only stays that took place can be reviewed.',
};

const STATUS: Record<string, string> = {
  published: 'Posted on the property page.',
  pending: "Waiting for a person to check it. It isn't shown yet.",
  hidden: 'Hidden by OpenBookings. Email support@openbookings.co to object.',
  removed: 'Removed by OpenBookings. Email support@openbookings.co to object.',
};

/** The signed-in guest's review of one booking: write it, see it, delete it. */
export default async function BookingReviewPage({ params }: { params: Promise<{ 'booking-ref': string }> }) {
  const { 'booking-ref': bookingId } = await params;
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

  const context = await getReviewContext(getPool(), bookingId, new Date());
  if (!context || context.guestUserId !== session.user.id) notFound();
  const eyebrow = `${context.propertyName} · ${formatStayMonth(context.stayMonth)}`;
  const back = (
    <Link href={`/bookings/${bookingId}`} className="text-sm text-white/70 underline underline-offset-4 hover:text-white">
      Back to your booking
    </Link>
  );

  if (context.review) {
    const { review } = context;
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
    return (
      <ReviewShell eyebrow={eyebrow} title="Your review">
        <div className="flex flex-col gap-5">
          <p className="font-serif text-5xl leading-none tabular-nums">
            {review.score}
            <span className="text-2xl text-white/45"> / 10</span>
          </p>
          {review.body ? <p className="text-[15px] whitespace-pre-line text-white/85">{review.body}</p> : null}
          <p className="text-sm text-white/55">{STATUS[review.status] ?? ''}</p>
          <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
            <DeleteReviewButton bookingId={bookingId} />
            {back}
          </div>
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
