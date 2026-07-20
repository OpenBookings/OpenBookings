import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginClient } from "./login-client";

const PRIVATE_ACCOUNT_MESSAGE =
  "This email address is associated with a private account. Please retry with a business email.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const [params, session] = await Promise.all([searchParams, getServerSession()]);

  if (session?.user) {
    if (session.user.account_type === "business") {
      // Already signed in — never show the login form. Only allow local paths
      // as redirect targets.
      const target =
        params.redirect?.startsWith("/") && !params.redirect.startsWith("//")
          ? params.redirect
          : "/onboarding";
      redirect(target);
    }
    // Signed in with a non-business account: show the login form with an
    // explanation; the client signs the session out so they can retry.
    return <LoginClient initialError={PRIVATE_ACCOUNT_MESSAGE} signOutOnMount />;
  }

  return (
    <LoginClient
      initialError={params.error === "private_account" ? PRIVATE_ACCOUNT_MESSAGE : null}
    />
  );
}
