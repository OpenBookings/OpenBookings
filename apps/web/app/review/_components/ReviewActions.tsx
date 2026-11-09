'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteMyReview, stopReviewEmailsWithToken } from '@/lib/reviews/actions';

/** Delete, with the booking page's inline confirm. The review can't be written again. */
export function DeleteReviewButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="self-start text-white/75 hover:bg-white/10 hover:text-white" onClick={() => setConfirming(true)}>
        Delete review
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm">
      <p className="font-medium text-white">Delete your review? You can&apos;t write a new one for this stay.</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteMyReview(bookingId);
              if (result.ok) router.refresh();
              else setMessage(result.message);
            })
          }
        >
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
      {message ? <p className="mt-2 text-white/70">{message}</p> : null}
    </div>
  );
}

/**
 * The opt-out from the emailed link. A button, not the link itself: mail
 * scanners open every link, and opening one must never change anything.
 */
export function StopReviewEmailsButton({ token }: { token: string }) {
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (done) return <p className="text-[15px]">{done}</p>;
  return (
    <Button
      disabled={pending}
      className="h-11 self-start bg-white text-black hover:bg-white/90"
      onClick={() =>
        startTransition(async () => {
          const result = await stopReviewEmailsWithToken(token);
          setDone(result.ok ? "Done. We won't ask you for reviews again. You can turn this back on in your account." : (result.message ?? 'Something went wrong.'));
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
      Stop review emails
    </Button>
  );
}
