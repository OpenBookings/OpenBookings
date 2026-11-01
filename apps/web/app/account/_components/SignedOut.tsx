"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";

/**
 * What /account/* shows without a session: the normal sign-in form, landing
 * back on the page that was asked for. The form is the Glass sign-in card, so
 * this view is Glass too.
 */
export function SignedOut() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const callbackURL = pathname.startsWith("/account") ? `${pathname}${query ? `?${query}` : ""}` : "/account";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#0a0a0a] px-4 text-white">
      <h1 className="text-center font-serif text-3xl">Sign in to see your account</h1>
      <div className="w-full max-w-sm">
        <AuthFormPhaseProvider>
          <AuthFormFields callbackURL={callbackURL} />
        </AuthFormPhaseProvider>
      </div>
    </main>
  );
}
