import { auth } from "@/lib/auth";
import { BACKDROP_COOKIE } from "@openbookings/images";
import { getBackdrop } from "@openbookings/images/server";
import { RememberBackdrop } from "@openbookings/images/react";
import { resolveCallbackPath } from "@openbookings/auth/callback-url";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginClient } from "./login-client";

const PRIVATE_ACCOUNT_MESSAGE =
  "This email address is associated with a private account. Please retry with a business email.";

const NOT_LINKED_MESSAGE =
  "An account already exists for this email. Sign in with the method you used originally — or, if this email belongs to your guest account, use a different address for your host account.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  // Deliberately the raw session, not getServerSession(): this page needs to
  // distinguish "signed in as a guest" (show an explanation, sign out) from
  // "not signed in" (show the form), and the validated helper collapses both
  // to null.
  const [params, session, { backdrop, persist }] = await Promise.all([
    searchParams,
    auth.api.getSession({ headers: await headers() }),
    cookies().then((jar) => getBackdrop(jar.get(BACKDROP_COOKIE)?.value)),
  ]);
  const remember = persist && backdrop ? <RememberBackdrop id={backdrop.id} /> : null;

  if (session?.user) {
    if (session.user.account_type === "business") {
      // Already signed in — never show the login form. Only allow local paths
      // as redirect targets.
      redirect(resolveCallbackPath(params.redirect, "/onboarding"));
    }
    // Signed in with a non-business account: show the login form with an
    // explanation; the client signs the session out so they can retry.
    return (
      <>
        <LoginClient backdrop={backdrop} initialError={PRIVATE_ACCOUNT_MESSAGE} signOutOnMount />
        {remember}
      </>
    );
  }

  const initialError =
    params.error === "private_account"
      ? PRIVATE_ACCOUNT_MESSAGE
      : params.error === "account_not_linked"
        ? NOT_LINKED_MESSAGE
        : null;

  return (
    <>
      <LoginClient backdrop={backdrop} initialError={initialError} />
      {remember}
    </>
  );
}
