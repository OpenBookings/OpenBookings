"use client"

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getRandomBackgroundImage } from "@/lib/background";
import { authClient } from "@/lib/auth-client";

import { SS_AuthForm } from "@/components/auth/SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";

const PRIVATE_ACCOUNT_MESSAGE =
  "This email address is associated with a private account. Please retry with a business email.";
const STUCK_MESSAGE = "Something went wrong signing you in. Please try again.";

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen visible />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redirectBlocked, setRedirectBlocked] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") || "/onboarding";
  const hasAttemptedRedirect = useRef(false);
  const { data: session, isPending: sessionPending } = authClient.useSession();

  // Only reveal the login form once we've confirmed there is no active session
  // (or we've decided not to redirect it away). While pending OR while a
  // session exists and a redirect is still in progress, keep the splash
  // visible so the login page never flashes through.
  const showLogin = !sessionPending && (!session?.user || redirectBlocked);

  useEffect(() => {
    if (sessionPending || !session?.user) return;

    // Server-side (proxy.ts) only lets "business" accounts past /onboarding
    // et al. Bouncing a mismatched account back there would just send it
    // straight back to /login — surface the error here instead.
    if (session.user.account_type !== "business") {
      setAuthError(PRIVATE_ACCOUNT_MESSAGE);
      setRedirectBlocked(true);
      authClient.signOut();
      return;
    }

    // If we already tried redirecting away once this session and ended up
    // back on /login anyway, don't loop forever — show an error instead.
    if (hasAttemptedRedirect.current) {
      setAuthError(STUCK_MESSAGE);
      setRedirectBlocked(true);
      return;
    }

    hasAttemptedRedirect.current = true;
    router.replace(redirectTarget);
  }, [session, sessionPending, router, redirectTarget]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "private_account") {
      setAuthError(PRIVATE_ACCOUNT_MESSAGE);
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  useEffect(() => {
    const CACHE_NAME = "ob_backgrounds";

    async function loadBackground() {
      let bg: { url: string; name: string };

      const stored = localStorage.getItem(CACHE_NAME);
      if (stored) {
        try {
          bg = JSON.parse(stored);
        } catch {
          bg = getRandomBackgroundImage();
          localStorage.setItem(CACHE_NAME, JSON.stringify(bg));
        }
      } else {
        bg = getRandomBackgroundImage();
        localStorage.setItem(CACHE_NAME, JSON.stringify(bg));
      }

      try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(bg.url);
        if (!response) {
          await cache.add(bg.url);
          response = await cache.match(bg.url);
        }
        if (response) {
          const blob = await response.blob();
          setBackgroundSrc(URL.createObjectURL(blob));
          return;
        }
      } catch {
        // Cache API unavailable (e.g. private browsing on some browsers)
      }

      setBackgroundSrc(bg.url);
    }

    loadBackground();
  }, []);

  return (
    <main className="fixed inset-0 min-h-screen bg-background">
      {/* Auth loading splash — hidden only once we confirm no active session */}
      <AuthLoadingScreen visible={!showLogin} />

      <div
        className="absolute inset-0 bg-black bg-cover bg-center bg-no-repeat z-0"
        style={{
          backgroundImage: backgroundSrc ? `url('${backgroundSrc}')` : undefined,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
          }}
        />
      </div>

      {/* Login card — fades in only when confirmed unauthenticated */}
      <div
        className="relative z-10 flex items-center justify-center min-h-screen w-full backdrop-blur-xl transition-opacity duration-500"
        style={{ opacity: showLogin ? 1 : 0 }}
      >
        <AuthFormPhaseProvider>
          <SS_AuthForm>
            <AuthFormFields initialError={authError} />
          </SS_AuthForm>
        </AuthFormPhaseProvider>
      </div>
    </main>
  );
}
