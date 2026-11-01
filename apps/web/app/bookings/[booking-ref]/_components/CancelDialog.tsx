'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { guestCancelRooms, guestPreviewCancel } from '../_lib/actions';

const euros = new Intl.NumberFormat('en-NL', { style: 'currency', currency: 'EUR' });

type Preview = { refund: number; retained: number };

/**
 * Cancel one room (`reservationIds`) or the whole booking (`null`). The exact
 * refund is fetched and shown before the guest confirms: what they read is
 * what the server calculates, from the same policy snapshot.
 */
export function CancelDialog({
  bookingId,
  reservationIds,
  label,
}: {
  bookingId: string;
  reservationIds: string[] | null;
  label: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState<'idle' | 'loading' | 'confirm' | 'cancelling' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function open() {
    setStep('loading');
    setMessage(null);
    const p = await guestPreviewCancel(bookingId, reservationIds).catch(() => null);
    if (!p) {
      setStep('error');
      setMessage('This booking can no longer be cancelled here. Contact support if you need help.');
      return;
    }
    setPreview(p);
    setStep('confirm');
  }

  async function confirm() {
    setStep('cancelling');
    const result = await guestCancelRooms(bookingId, reservationIds).catch(() => null);
    if (!result || !result.ok) {
      setStep('error');
      setMessage(
        result?.ok === false && result.error === 'already_cancelled'
          ? 'Already cancelled.'
          : 'Something went wrong. Nothing was cancelled. Please try again.',
      );
      return;
    }
    setStep('idle');
    setMessage(
      result.refunds.some((r) => r.status === 'failed')
        ? "Cancelled. Your refund hasn't gone through yet; we're on it and you don't need to do anything."
        : null,
    );
    router.refresh();
  }

  if (step === 'confirm' && preview) {
    return (
      <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm">
        <p className="font-medium text-white">
          {preview.refund > 0
            ? `You'll get ${euros.format(preview.refund)} back. The hotel keeps ${euros.format(preview.retained)}.`
            : `You won't get anything back. The hotel keeps ${euros.format(preview.retained)}.`}
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="destructive" size="sm" onClick={confirm}>
            Cancel {label}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={step === 'loading' || step === 'cancelling'}
        onClick={open}
      >
        {step === 'loading' ? 'Working out your refund…' : step === 'cancelling' ? 'Cancelling…' : `Cancel ${label}`}
      </Button>
      {message && <p className="text-sm text-white/70">{message}</p>}
    </div>
  );
}
