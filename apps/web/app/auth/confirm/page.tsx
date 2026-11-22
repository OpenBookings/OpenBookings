import type { Metadata } from 'next';
import Link from 'next/link';
import { magicLinkEmail, magicLinkVerifyHref } from '@openbookings/auth/magic-link-confirm';
import { Button } from '@/components/ui/button';
import { auth, getServerSession } from '@/lib/auth';
import { ReviewShell } from '../../review/_components/ReviewShell';

// The token is in this page's URL: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Where a sign-in link opened from outside the site lands (GHSA-574j): it
 * names the account the link signs in to, and only the button signs in.
 * Opening this page does not use up the link.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  const [email, session] = await Promise.all([magicLinkEmail(auth, token), getServerSession()]);
  const href = magicLinkVerifyHref(params);

  if (!email || !href) {
    return (
      <ReviewShell title="This sign-in link has expired">
        <div className="flex flex-col gap-5">
          <p className="text-[15px] text-white/75">
            Sign-in links work once and for 15 minutes. Ask for a new one and use the latest email.
          </p>
          <Button asChild className="h-11 self-start bg-white text-black hover:bg-white/90">
            <Link href="/account">Sign in</Link>
          </Button>
        </div>
      </ReviewShell>
    );
  }

  const otherAccount = session?.user.email && session.user.email.toLowerCase() !== email.toLowerCase() ? session.user.email : null;

  return (
    <ReviewShell title="Sign in to OpenBookings?">
      <div className="flex flex-col gap-5">
        <p className="text-[15px] text-white/75">
          This link signs you in as <span className="font-medium text-white break-all">{email}</span>.
        </p>
        {otherAccount ? (
          <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-[15px] text-amber-100">
            You&apos;re signed in as <span className="font-medium break-all">{otherAccount}</span>. Continuing signs you out of that
            account.
          </p>
        ) : null}
        <p className="text-[15px] text-white/75">
          If this isn&apos;t your email address, or you didn&apos;t ask for a sign-in link, close this page.
        </p>
        {/* A plain link, not next/link: no prefetch, and the browser sends it as same-origin. */}
        <Button asChild className="h-11 self-start bg-white text-black hover:bg-white/90">
          <a href={href}>Continue as {email}</a>
        </Button>
      </div>
    </ReviewShell>
  );
}
