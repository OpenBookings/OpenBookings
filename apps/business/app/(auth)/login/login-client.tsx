"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useBackdrop } from "@/lib/use-backdrop";
import { authClient } from "@/lib/auth-client";

import { SS_AuthForm } from "@/components/auth/SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";

export function LoginClient({
  initialError,
  signOutOnMount,
}: {
  initialError?: string | null;
  signOutOnMount?: boolean;
}) {
  const backdrop = useBackdrop();

  // The server page renders us with an error for non-business sessions;
  // clear that session so the user can retry with a business account.
  useEffect(() => {
    if (signOutOnMount) authClient.signOut();
  }, [signOutOnMount]);

  // Strip ?error=... from the address bar; the message itself came in as a prop.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      window.history.replaceState({}, "", "/login");
    }
  }, []);


  return (
    <main className="fixed inset-0 min-h-screen bg-background">
      <div className="absolute inset-0 bg-black z-0">
        {backdrop && (
          <Image
            src={backdrop.url}
            alt=""
            fill
            sizes="100vw"
            loading="eager"
            fetchPriority="high"
            className="object-cover object-center"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 flex items-center justify-center min-h-screen w-full backdrop-blur-xl">
        <AuthFormPhaseProvider>
          <SS_AuthForm>
            <AuthFormFields initialError={initialError} />
          </SS_AuthForm>
        </AuthFormPhaseProvider>
      </div>
    </main>
  );
}
