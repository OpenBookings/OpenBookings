import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getPool } from '@openbookings/db';
import { bookingForReviewToken, getReviewContext } from '@openbookings/db/reviews';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import { ReviewForm } from '../_components/ReviewForm';
import { formatStayMonth, ReviewShell } from '../_components/ReviewShell';

// The token is in the URL: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Review your stay', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const CLOSED: Record<string, string> = {
  too_early: 'You can review this stay from 24 hours after check-out.',
  window_closed: 'Reviews can be written up to 30 days after check-out. This one has closed.',
  no_show: 'Only stays that took place can be reviewed.',
  not_stayed: 'Only stays that took place can be reviewed.',
};

/**
 * The emailed link. Opening it changes nothing (mail scanners open links
 * first); it shows the form for this one stay. It never signs anyone in.
 */
export default async function ReviewByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();

  const ip = getClientIP(new Request('http://localhost', { headers: await headers() }));
  if (!checkRateLimit(`review-token:${ip}`, 20, 10 * 60 * 1000).allowed) {
    return (
      <ReviewShell title="Too many tries">
        <p className="text-[15px] text-white/75">Wait a few minutes, then open the link from your email again.</p>
      </ReviewShell>
    );
  }

  const bookingId = await bookingForReviewToken(getPool(), token, now);
  const context = bookingId ? await getReviewContext(getPool(), bookingId, now) : null;
  if (!context) {
    return (
      <ReviewShell title="This link has expired">
        <p className="text-[15px] text-white/75">
          Review links work for 30 days after check-out, and only until the stay is reviewed. If you can still review it, you&apos;ll find it
          under{' '}
          <Link href="/account/bookings?tab=past" className="underline underline-offset-4">
            your past bookings
          </Link>
          .
        </p>
      </ReviewShell>
    );
  }

  const stayed = `stayed in ${formatStayMonth(context.stayMonth)}`;
  const session = await getServerSession();
  if (session && session.user.id !== context.guestUserId) {
    return (
      <ReviewShell eyebrow={context.propertyName} title="Wrong account">
        <p className="text-[15px] text-white/75">
          You&apos;re signed in with a different account than the one that booked this stay. Sign out, then open the link again.
        </p>
      </ReviewShell>
    );
  }

  if (context.review) {
    return (
      <ReviewShell eyebrow={context.propertyName} title="Already reviewed">
        <p className="text-[15px] text-white/75">
          This stay has a review.{' '}
          <Link href={`/bookings/${context.bookingId}/review`} className="underline underline-offset-4">
            See it in your account
          </Link>
          .
        </p>
      </ReviewShell>
    );
  }

  if (!context.eligibility.ok) {
    return (
      <ReviewShell eyebrow={context.propertyName} title="Can't review this stay">
        <p className="text-[15px] text-white/75">{CLOSED[context.eligibility.reason] ?? 'This stay cannot be reviewed.'}</p>
      </ReviewShell>
    );
  }

  return (
    <ReviewShell eyebrow={context.propertyName} title="How was your stay?">
      <p className="mb-6 text-sm text-white/65">
        Posting as <span className="text-white">{context.authorName}</span>
        {context.authorCountry ? ` (${context.authorCountry})` : ''} · {stayed} ·{' '}
        <Link href={`/bookings/${context.bookingId}/review`} className="underline underline-offset-4 hover:text-white">
          Not you?
        </Link>
      </p>
      <ReviewForm proof={{ kind: 'token', token, bookingId: context.bookingId }} propertyName={context.propertyName} />
    </ReviewShell>
  );
}
