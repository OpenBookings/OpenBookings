'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CheckoutErrorCopy } from '../_lib/errors';

export type CheckoutNoticeProps = {
  copy: CheckoutErrorCopy;
  /** Rendered only when the failure is actually worth retrying in place. */
  onRetry?: () => void;
  /** "Try again" reads wrong for a lapsed hold, which is a fresh start. */
  retryLabel?: string;
};

/**
 * Shown instead of the payment form when checkout cannot start or cannot
 * continue.
 *
 * There is deliberately no retry button on a failure `copy` marks as
 * unretryable: a button that reruns something we know will fail again teaches
 * the guest to keep pressing it. Those cases get a way out of the page
 * instead.
 */
export function CheckoutNotice({ copy, onRetry, retryLabel = 'Try again' }: CheckoutNoticeProps) {
  return (
    <div
      role="alert"
      className="mx-auto w-full max-w-md space-y-5 rounded-3xl bg-white/90 p-8 text-neutral-900 shadow-2xl backdrop-blur-md"
    >
      <AlertTriangle className="size-8 text-amber-600" aria-hidden="true" />
      <p className="text-base leading-relaxed">{copy.message}</p>

      {copy.retryable && onRetry ? (
        <Button
          onClick={onRetry}
          className="h-12 w-full rounded-xl bg-[#a5b4f0] text-base font-semibold text-neutral-900 hover:bg-[#93a4e8]"
        >
          {retryLabel}
        </Button>
      ) : (
        <Button
          asChild
          variant="outline"
          className="h-12 w-full rounded-xl border-neutral-300 text-base font-semibold"
        >
          <Link href="/">Back to the property</Link>
        </Button>
      )}
    </div>
  );
}
