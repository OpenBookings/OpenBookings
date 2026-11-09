'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { submitReviewAsGuest, submitReviewWithToken, type ReviewActionResult } from '@/lib/reviews/actions';

const MAX = 2000;
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export type ReviewFormProof = { kind: 'session'; bookingId: string } | { kind: 'token'; token: string; bookingId: string };

/**
 * A score from 1 to 10 (required) and a few words (optional). One form for
 * both ways in: the Account tab (session) and the emailed link (token).
 */
export function ReviewForm({ proof, propertyName }: { proof: ReviewFormProof; propertyName: string }) {
  const [score, setScore] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [result, setResult] = useState<ReviewActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-3 text-[15px]">
        <p className="font-medium">{result.status === 'published' ? 'Thanks, your review is posted.' : "Thanks. We'll take a look first."}</p>
        <p className="text-white/65">
          {result.status === 'published'
            ? `It's on the ${propertyName} page now. You can delete it from your account at any time.`
            : 'It contains something our checks hold back, such as a link or contact details. A person looks at it before it is shown.'}
        </p>
        <Link href={`/bookings/${proof.bookingId}/review`} className="text-sm text-white/80 underline underline-offset-4 hover:text-white">
          See your review
        </Link>
      </div>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (score === null) {
      setResult({ ok: false, message: 'Choose a score from 1 to 10.' });
      return;
    }
    startTransition(async () => {
      const input = { score, body };
      setResult(
        proof.kind === 'session' ? await submitReviewAsGuest(proof.bookingId, input) : await submitReviewWithToken(proof.token, input),
      );
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <fieldset>
        <legend className="text-sm font-medium">How would you score your stay?</legend>
        <p className="mt-1 text-[13px] text-white/55">1 is very poor, 10 is excellent.</p>
        <div role="radiogroup" aria-label="Score from 1 to 10" className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {SCORES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              onClick={() => setScore(n)}
              className={cn(
                'h-11 rounded-xl border text-[15px] tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                score === n
                  ? 'border-white bg-white font-semibold text-black'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/15',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="review-body" className="text-sm font-medium">
          Tell the next guests about it <span className="font-normal text-white/50">(optional)</span>
        </label>
        <Textarea
          id="review-body"
          value={body}
          maxLength={MAX}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What stood out? What could be better?"
          className="mt-2 min-h-32 border-white/15 bg-white/5 text-white placeholder:text-white/40 dark:bg-white/5"
        />
        <p className="mt-1 text-right text-xs text-white/45 tabular-nums">
          {body.length} / {MAX}
        </p>
      </div>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-(--red-9)">
          {result.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={pending} className="h-11 bg-white text-black hover:bg-white/90">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Post review
        </Button>
        <p className="text-[13px] text-white/55">
          Shown with your first name and country, and the month you stayed. Reviews can&apos;t be edited once posted, only deleted.
        </p>
      </div>
    </form>
  );
}
