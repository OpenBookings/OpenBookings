"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";
import { CS_AuthForm } from "@/components/auth/CS-AuthForm";

interface NavProps {
  authError: string | null;
  onDismissAuthError: () => void;
}

export function Nav({ authError, onDismissAuthError }: NavProps) {
  const router = useRouter();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [cookiesEnabled, setCookiesEnabled] = useState<boolean | null>(null);
  const profileMenuCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const user = session?.user ?? null;

  useEffect(() => {
    setCookiesEnabled(navigator.cookieEnabled);
  }, []);

  useEffect(() => {
    return () => {
      if (profileMenuCloseTimeoutRef.current) {
        clearTimeout(profileMenuCloseTimeoutRef.current);
      }
    };
  }, []);

  const openProfileMenu = () => {
    if (profileMenuCloseTimeoutRef.current) {
      clearTimeout(profileMenuCloseTimeoutRef.current);
      profileMenuCloseTimeoutRef.current = null;
    }
    setProfileMenuOpen(true);
  };

  const closeProfileMenuWithDelay = () => {
    if (profileMenuCloseTimeoutRef.current) {
      clearTimeout(profileMenuCloseTimeoutRef.current);
    }
    profileMenuCloseTimeoutRef.current = setTimeout(() => {
      setProfileMenuOpen(false);
      profileMenuCloseTimeoutRef.current = null;
    }, 220);
  };

  return (
    <>
      {/* Logo in top left corner */}
      <div
        className="fixed top-0 left-0 p-4 sm:p-6 md:p-8 z-20 flex flex-row items-center gap-2 select-none"
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        }}
      >
        <img
          src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
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
      </div>

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
          {sessionPending ? null : user ? (
            <div
              className="relative flex items-center"
              onMouseEnter={openProfileMenu}
              onMouseLeave={closeProfileMenuWithDelay}
            >
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="rounded-full"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-label="Open profile menu"
              >
                <img
                  src="/profile_avatar.png"
                  alt="User Profile"
                  className="h-6 sm:h-10 md:h-14 rounded-full object-cover border border-white/20 shadow"
                  draggable="false"
                  style={{
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    MozUserSelect: "none",
                    msUserSelect: "none",
                  }}
                />
              </button>
              {profileMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 z-30 min-w-64 rounded-xl border border-white/15 bg-black/90 backdrop-blur-sm p-3 shadow-xl select-none"
                  role="menu"
                >
                  <div className="text-[11px] uppercase tracking-wide text-white/50">
                    Signed in as
                  </div>
                  <div className="mt-1 break-all text-sm text-white/90">{user.email}</div>
                  <div className="mt-3 text-[11px] uppercase tracking-wide text-white/50">
                    Cookies
                  </div>
                  <div className="mt-1 text-sm text-white/90">
                    {cookiesEnabled === null
                      ? "Checking..."
                      : cookiesEnabled
                        ? "Enabled"
                        : "Disabled"}
                  </div>
                  <button
                    type="button"
                    className="mt-4 w-full rounded-lg border border-white/20 px-3 py-2 text-left text-sm font-medium text-white/90 hover:bg-white/10 transition-colors"
                    role="menuitem"
                    onClick={async () => {
                      posthog.capture("sign_out");
                      posthog.reset();
                      await authClient.signOut();
                      setProfileMenuOpen(false);
                      router.replace("/");
                    }}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <CS_AuthForm />
          )}
        </div>
      </div>
    </>
  );
}
