'use client';

import { useState } from 'react';

export function StripeConnectStep() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch('/api/stripe/account-link', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to start Stripe onboarding');
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Stripe onboarding');
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-sm text-white/50 max-w-sm">
        You&apos;ll be redirected to Stripe to securely verify your identity and connect your
        payout details. Once you&apos;re done, you&apos;ll be brought back here automatically.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={isPending}
        className="bg-ob-brand hover:bg-ob-brand-light disabled:opacity-50 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
        onClick={handleContinue}
      >
        {isPending ? 'Redirecting…' : 'Continue to Stripe'}
      </button>
    </div>
  );
}
