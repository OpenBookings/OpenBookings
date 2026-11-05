"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { CS_AuthForm } from "@/components/auth/CS-AuthForm";
import { AccountMenu, initials } from "@/components/account/AccountMenu";
import { writeNavHint } from "@/lib/nav-hint";

interface NavProps {
  authError?: string | null;
  onDismissAuthError?: () => void;
}

/** The Glass top corners: logo (home link) left, account menu or sign-in right. */
export function Nav({ authError = null, onDismissAuthError }: NavProps) {
  const { data: session, isPending: sessionPending, error: sessionError } = authClient.useSession();
  const user = session?.user ?? null;
  const userInitials = user ? initials(user.name?.trim() || "") : null;

  // Keep the device's hint in step with the real answer, for the next visit.
  // A failed check (offline, server error) is not an answer: it must not mark
  // a signed-in visitor as signed out.
  useEffect(() => {
    if (sessionPending || sessionError) return;
    writeNavHint(userInitials ? { signedIn: true, initials: userInitials } : { signedIn: false });
  }, [sessionPending, sessionError, userInitials]);

  return (
    <>
      {/* Logo in top left corner */}
      <Link
        href="/"
        className="fixed top-0 left-0 p-4 sm:p-6 md:p-8 z-20 flex flex-row items-center gap-2 select-none"
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        }}
      >
        <Image
          src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
          width={96}
          height={72}
          preload
          alt="OpenBookings Logo"
          className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none"
          draggable="false"
          style={{
            userSelect: "none",
            WebkitUserSelect: "none",
            MozUserSelect: "none",
            msUserSelect: "none",
          }}
        />
      </Link>

      {/* Profile in top right corner */}
      <div className="fixed top-0 right-0 p-4 sm:p-6 md:p-8 z-20 flex flex-col items-end justify-center gap-2">
        {authError && (
          <div
            role="alert"
            className="text-red-200 text-xs bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg border border-red-400/40 max-w-xs text-right cursor-pointer"
            onClick={onDismissAuthError}
          >
            {authError}
          </div>
        )}
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          {user ? (
            <AccountMenu user={user} variant="glass" />
          ) : (
            <>
              {/* Until the session check returns, the corner shows what this
                  device saw last time (lib/nav-hint.ts): an avatar-shaped
                  placeholder with the initials, or the real sign-in button.
                  CSS picks between them, so it is right before hydration. */}
              {sessionPending && (
                <span
                  aria-hidden
                  className="nav-hint-in size-8 items-center justify-center rounded-full border border-white/20 bg-black/60 text-sm text-white shadow select-none sm:size-10 md:size-14 md:text-base"
                />
              )}
              <div className={sessionPending ? "nav-hint-out contents" : "contents"}>
                <CS_AuthForm />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
