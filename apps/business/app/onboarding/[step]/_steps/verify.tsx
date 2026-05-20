"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { completeOnboarding } from "../../actions";

interface OnboardingStatus {
  steps: { coreInfoText: boolean; coreInfoLocation: boolean; legalNBoring: boolean };
  stripe: {
    accountId: string;
    currentlyDue: string[];
    eventuallyDue: string[];
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  onboardingCompleted: boolean;
}

const STRIPE_APPEARANCE = {
  variables: {
    colorPrimary: "#0085FF",
    colorText: "#C9CED8",
    colorBackground: "rgba(0,0,0,0)",
    buttonSecondaryColorBackground: "#2B3039",
    buttonSecondaryColorText: "#C9CED8",
    colorSecondaryText: "#8C99AD",
    actionSecondaryColorText: "#C9CED8",
    actionSecondaryTextDecorationColor: "#C9CED8",
    colorBorder: "#2B3039",
    colorDanger: "#F23154",
    badgeNeutralColorBackground: "#1B1E25",
    badgeNeutralColorBorder: "#2B3039",
    badgeNeutralColorText: "#8C99AD",
    badgeSuccessColorBackground: "#152207",
    badgeSuccessColorBorder: "#20360C",
    badgeSuccessColorText: "#3EAE20",
    badgeWarningColorBackground: "#400A00",
    badgeWarningColorBorder: "#5F1400",
    badgeWarningColorText: "#F27400",
    badgeDangerColorBackground: "#420320",
    badgeDangerColorBorder: "#61092D",
    badgeDangerColorText: "#F46B7D",
    offsetBackgroundColor: "rgba(0,0,0,0)",
    formBackgroundColor: "rgba(0,0,0,0)",
    overlayBackdropColor: "rgba(0,0,0,0.5)",
  },
};

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch status");
    return r.json() as Promise<OnboardingStatus>;
  });

export function VerifyStep() {
  const router = useRouter();
  const { data, mutate } = useSWR<OnboardingStatus>("/api/onboarding/status", fetcher, {
    refreshInterval: 5000,
  });

  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const completingRef = useRef(false);

  // Redirect to the right step if preconditions not met
  useEffect(() => {
    if (!data) return;
    if (!data.steps.coreInfoText) { router.push("/onboarding/core-info-text"); return; }
    if (!data.steps.coreInfoLocation) { router.push("/onboarding/core-info-location"); return; }
    if (!data.steps.legalNBoring) { router.push("/onboarding/legal-n-boring"); return; }
    if (!data.stripe) { router.push("/onboarding/stripe-connect"); return; }
    if (data.onboardingCompleted) { router.push("/dashboard"); return; }

    // Clean — complete onboarding
    if (data.stripe.currentlyDue.length === 0 && data.stripe.chargesEnabled && !completingRef.current) {
      completingRef.current = true;
      completeOnboarding().then(() => router.push("/dashboard"));
    }
  }, [data, router]);

  // Initialise Connect instance when we know there are requirements to collect
  useEffect(() => {
    if (!data?.stripe || data.stripe.currentlyDue.length === 0) return;
    if (instance) return;

    const stripeConnect = loadConnectAndInitialize({
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
      fetchClientSecret: async () => {
        const res = await fetch("/api/stripe/account-session", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to create account session");
        }
        const { client_secret } = await res.json() as { client_secret: string };
        return client_secret;
      },
      appearance: STRIPE_APPEARANCE,
    });
    setInstance(stripeConnect);
  }, [data, instance]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="size-5 rounded-full border-2 border-ob-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const { stripe } = data;

  // Requirements still outstanding — show embedded onboarding
  if (stripe && stripe.currentlyDue.length > 0 && instance) {
    return (
      <ConnectComponentsProvider connectInstance={instance}>
        <ConnectAccountOnboarding
          onExit={() => { setInstance(null); mutate(); }}
          collectionOptions={{ fields: "eventually_due" }}
        />
      </ConnectComponentsProvider>
    );
  }

  // Requirements outstanding but instance not ready yet
  if (stripe && stripe.currentlyDue.length > 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="size-5 rounded-full border-2 border-ob-brand border-t-transparent animate-spin" />
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
