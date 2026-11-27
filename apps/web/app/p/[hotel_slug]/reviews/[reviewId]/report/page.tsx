import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@openbookings/db';
import { loadReportTarget, type ModerationItem } from '@openbookings/db/reviews';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { getServerSession } from '@/lib/auth';
import { ReviewShell } from '@/app/review/_components/ReviewShell';
import { countryName, stayMonthLabel } from '../../../_lib/reviews-view';
import { ReportForm } from './report-form';

export const metadata: Metadata = { title: 'Report a review', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Params = { hotel_slug: string; reviewId: string };
type Search = { reply?: string | string[]; 'sign-in'?: string | string[] };

/**
 * "Report this review" from the property page: a published review, or with
 * ?reply= one published reply under it. Anyone may report; signed in, they
 * can ask for the outcome at their account's email. ?sign-in=1 shows the
 * sign-in form first and comes back here.
 */
export default async function ReportReviewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { hotel_slug: slug, reviewId } = await params;
  const search = await searchParams;
  const replyId = typeof search.reply === 'string' ? search.reply : null;
  const item: ModerationItem = replyId ? { kind: 'reply', id: replyId } : { kind: 'review', id: reviewId };

  const target = await loadReportTarget(getPool(), item);
  // A reply's review comes from the reply: the URL's review id must agree with it.
  if (!target || target.reviewId !== reviewId || target.propertySlug !== slug) notFound();

  const here = `/p/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(reviewId)}/report${replyId ? `?reply=${encodeURIComponent(replyId)}` : ''}`;
  const propertyHref = `/p/${encodeURIComponent(slug)}`;
  const session = await getServerSession();

  if (!session && search['sign-in'] === '1') {
    return (
      <ReviewShell title="Sign in to get updates">
        <AuthFormPhaseProvider>
          <AuthFormFields callbackURL={here} />
        </AuthFormPhaseProvider>
        <p className="mt-6 text-[13px] text-white/55">
          <Link href={here} className="underline underline-offset-4 hover:text-white">
            Report without signing in
          </Link>
        </p>
      </ReviewShell>
    );
  }

  const byline = [target.authorName, countryName(target.authorCountry), stayMonthLabel(target.stayMonth, true)].filter(Boolean).join(' · ');
  const who =
    target.replyRole === 'host'
      ? `Response from ${target.propertyName} to ${target.authorName}'s review`
      : target.replyRole === 'guest'
        ? `${target.authorName} answered`
        : byline;
  const what = target.replyRole ? 'reply' : 'review';
  const backLabel = `Back to ${target.propertyName}`;

  return (
    <ReviewShell
      eyebrow={
        <Link href={propertyHref} className="hover:text-white">
          ← {backLabel}
        </Link>
      }
      title={target.replyRole ? 'Report a reply' : 'Report a review'}
    >
      <div className="flex flex-col gap-5">
        <blockquote className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/4 px-4 py-3.5">
          <span className="text-[13px] text-white/55">{who}</span>
          <span className="text-[15px] leading-relaxed whitespace-pre-line text-white/85">
            {target.body ? `“${target.body}”` : `${target.authorName} gave a score without writing a review.`}
          </span>
        </blockquote>
        <p className="text-[15px] leading-relaxed text-white/65">
          A person at OpenBookings checks it against our{' '}
          <Link href="/legal/review-rules" className="underline underline-offset-4 hover:text-white">
            review rules
          </Link>
          . The {what} stays up while we check. Disagreeing with a review, or a low score, isn&apos;t a reason to remove it.
        </p>
        <ReportForm
          item={target.item}
          email={session?.user.email ?? null}
          signInHref={`${here}${replyId ? '&' : '?'}sign-in=1`}
          backHref={propertyHref}
          backLabel={backLabel}
        />
      </div>
    </ReviewShell>
  );
}
