import type { Metadata } from 'next';
import Link from 'next/link';
import { StopReviewEmailsButton } from '../../_components/ReviewActions';
import { ReviewShell } from '../../_components/ReviewShell';

export const metadata: Metadata = { title: 'Review emails', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** The opt-out from a review email. Opening the page changes nothing; the button does. */
export default async function StopReviewEmailsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <ReviewShell title="Stop review emails?">
      <div className="flex flex-col gap-5">
        <p className="text-[15px] text-white/75">
          We&apos;ll stop asking you to review your stays: no invitations, no reminders. Booking emails keep coming. You can turn this back
          on under{' '}
          <Link href="/account/privacy" className="underline underline-offset-4">
            Privacy &amp; data
          </Link>
          .
        </p>
        <StopReviewEmailsButton token={token} />
      </div>
    </ReviewShell>
  );
}
