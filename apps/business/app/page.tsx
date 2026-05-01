"use client"

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getRandomBackgroundImage } from "@/lib/background";
import { authClient } from "@/lib/auth-client";

import { SS_AuthForm } from "@/components/auth/SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";

const PRIVATE_ACCOUNT_MESSAGE =
  "This email address is associated with a private account. Please retry with a business email.";

export default function Home() {
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  useEffect(() => {
    if (session?.user) {
      const timeout = setTimeout(() => {
        router.replace("/onboarding");
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [session, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "private_account") {
      setAuthError(PRIVATE_ACCOUNT_MESSAGE);
      window.history.replaceState({}, "", "/");
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

      {/* Login card — fades in as splash fades out */}
      <div
        className="relative z-10 flex items-center justify-center min-h-screen w-full backdrop-blur-xl transition-opacity duration-500"
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
