'use client';

import { useEffect, useState } from 'react';
import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from '@stripe/connect-js';
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js';

interface Props {
  onComplete: () => void;
}

export function StripeConnectStep({ onComplete }: Props) {
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stripeConnect = loadConnectAndInitialize({
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
      fetchClientSecret: async () => {
        const res = await fetch('/api/stripe/account-session', { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to create account session');
        }
        const { client_secret } = await res.json();
        return client_secret;
      },
      appearance: {
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
        }
      },
    });
    setInstance(stripeConnect);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <button
          className="text-xs text-white/40 underline"
          onClick={() => { setError(null); }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="size-5 rounded-full border-2 border-ob-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <ConnectAccountOnboarding onExit={onComplete} />
    </ConnectComponentsProvider>
  );
}
