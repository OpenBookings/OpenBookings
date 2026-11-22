import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { magicLinkEmail, magicLinkVerifyHref } from "@openbookings/auth/magic-link-confirm";
import { BACKDROP_COOKIE } from "@openbookings/images";
import { getBackdrop } from "@openbookings/images/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";

// The token is in this page's URL: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where a sign-in link opened from outside the console lands (GHSA-574j): it
 * names the account the link signs in to, and only the button signs in.
 * Opening this page does not use up the link.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const [email, session, { backdrop }] = await Promise.all([
    magicLinkEmail(auth, token),
    auth.api.getSession({ headers: await headers() }).catch(() => null),
    cookies().then((jar) => getBackdrop(jar.get(BACKDROP_COOKIE)?.value)),
  ]);
  const href = magicLinkVerifyHref(params);
  const signedInAs = session?.user?.email ?? null;
  const otherAccount = email && signedInAs && signedInAs.toLowerCase() !== email.toLowerCase() ? signedInAs : null;

  return (
    <main className="fixed inset-0 min-h-screen bg-background">
      <div className="absolute inset-0 bg-black z-0">
        {backdrop && (
          <Image src={backdrop.url} alt="" fill sizes="100vw" preload className="object-cover object-center" />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 flex items-center justify-center min-h-screen w-full px-4 backdrop-blur-xl">
        <Card className="relative w-full max-w-sm mx-auto border-0">
          <CardHeader className="text-center flex flex-col items-center gap-3">
            <Image
              src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
              width={96}
              height={72}
              alt="OpenBookings"
              className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none"
              draggable={false}
            />
            <CardTitle>{email && href ? "Sign in to OpenBookings?" : "This sign-in link has expired"}</CardTitle>
            {email && href ? (
              <CardDescription>
                This link signs you in as <span className="font-medium text-foreground break-all">{email}</span>.
              </CardDescription>
            ) : (
              <CardDescription>Sign-in links work once and for 15 minutes. Ask for a new one and use the latest email.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {email && href ? (
              <>
                {otherAccount ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                    You&apos;re signed in as <span className="font-medium break-all">{otherAccount}</span>. Continuing signs you out
                    of that account.
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  If this isn&apos;t your email address, or you didn&apos;t ask for a sign-in link, close this page.
                </p>
                {/* A plain link, not next/link: no prefetch, and the browser sends it as same-origin. */}
                <Button asChild className="w-full">
                  <a href={href}>Continue</a>
                </Button>
              </>
            ) : (
              <Button asChild className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
