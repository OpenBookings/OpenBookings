"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { completeOnboarding } from "../actions";
import type { OnboardingStatus } from "../_lib/status";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch status");
    return r.json() as Promise<OnboardingStatus>;
  });

export function VerifyStep({ initialStatus }: { initialStatus: OnboardingStatus }) {
  const router = useRouter();
  const { data } = useSWR<OnboardingStatus>("/api/onboarding/status", fetcher, {
    refreshInterval: 5000,
    fallbackData: initialStatus,
  });

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completingRef = useRef(false);

  // The server page (stripe/page.tsx) already redirects when preconditions
  // aren't met; this only reacts to status changes picked up while polling.
  useEffect(() => {
    if (!data) return;
    if (!data.steps.coreInfoText) { router.replace("/onboarding/core-info"); return; }
    if (!data.steps.coreInfoLocation) { router.replace("/onboarding/address"); return; }
    if (!data.steps.legalNBoring) { router.replace("/onboarding/legal"); return; }
    if (!data.stripe) { router.replace("/onboarding/legal"); return; }
    if (data.onboardingCompleted) { router.replace("/dashboard"); return; }

    // Clean — complete onboarding
    if (data.stripe.currentlyDue.length === 0 && data.stripe.chargesEnabled && !completingRef.current) {
      completingRef.current = true;
      completeOnboarding().then(() => router.replace("/dashboard"));
    }
  }, [data, router]);

  async function handleContinue() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch("/api/stripe/account-link", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to start Stripe onboarding");
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Stripe onboarding");
      setIsPending(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="size-5 rounded-full border-2 border-ob-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const { stripe } = data;

  // Requirements still outstanding — send them back to hosted onboarding
  if (stripe && stripe.currentlyDue.length > 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h2 className="text-lg font-semibold text-white">A few more details are needed</h2>
        <p className="text-sm text-white/45 max-w-sm">
          Stripe still needs some information from you before you can start accepting bookings.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={isPending}
          className="bg-ob-brand hover:bg-ob-brand-light disabled:opacity-50 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
          onClick={handleContinue}
        >
          {isPending ? "Redirecting…" : "Continue to Stripe"}
        </button>
      </div>
    );
  }

  // No requirements left but charges not yet enabled — under review
  if (stripe && !stripe.chargesEnabled) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="size-12 rounded-full bg-white/6 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white/50">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white">Your account is under review</h2>
        <p className="text-sm text-white/45 max-w-sm">
          Stripe is reviewing your information. This usually takes a few minutes. This page will
          update automatically — no need to refresh.
        </p>
      </div>
    );
  }

  // Completing — show spinner
  return (
    <div className="flex items-center justify-center py-16">
      <div className="size-5 rounded-full border-2 border-ob-brand border-t-transparent animate-spin" />
    </div>
  );
}
