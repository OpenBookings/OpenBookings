'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, Loader2 } from 'lucide-react';
import { REVIEW_RULE_IDS, REVIEW_RULES } from '@openbookings/pricing';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { reportReviewPublic } from '@/lib/reviews/report-actions';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile-actions';
import { useTurnstileToken } from '@/lib/use-turnstile-token';

const NOTE_MAX = 1000;

const FIELD = 'w-full rounded-[10px] border border-white/18 bg-white/5 px-3 text-[15px] text-white outline-none focus-visible:ring-2 focus-visible:ring-white/40';

/**
 * The public report form. Turnstile runs invisibly (it only draws a box when
 * Cloudflare wants a click); every attempt spends its token, so a refused one
 * mints a fresh token before the next try. Updates by email are only offered
 * to a signed-in reader, at their account's address, shown read-only.
 */
export function ReportForm({
  item,
  email,
  signInHref,
  backHref,
  backLabel,
}: {
  item: { kind: 'review' | 'reply'; id: string };
  /** The signed-in reader's account email; null when signed out. */
  email: string | null;
  signInHref: string;
  backHref: string;
  backLabel: string;
}) {
  const [rule, setRule] = useState('');
  const [note, setNote] = useState('');
  const [updates, setUpdates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Sent; `emailed`: the action stored the account email for the outcome. */
  const [done, setDone] = useState<{ emailed: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const {
    token,
    failed: turnstileFailed,
    containerRef: turnstileRef,
    reset: resetTurnstile,
  } = useTurnstileToken({ enabled: done === null, action: TURNSTILE_ACTIONS.reviewReport });

  if (done) {
    return (
      <div className="flex flex-col gap-3 text-[15px]">
        <p className="font-medium">Thanks. A person will check this review against our review rules.</p>
        <p className="text-white/65">
          {done.emailed && email ? `We'll email the outcome to ${email}.` : 'It stays on the page while we check it.'}
        </p>
        <Link href={backHref} className="text-sm text-white/80 underline underline-offset-4 hover:text-white">
          {backLabel}
        </Link>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!rule) return setError('Choose the rule it breaks.');
    startTransition(async () => {
      setError(null);
      const result = await reportReviewPublic({ item, rule, note, updates: email !== null && updates, turnstileToken: token });
      if (result.ok) setDone({ emailed: result.emailStored });
      else {
        setError(result.message);
        // The token was spent at Cloudflare either way.
        resetTurnstile();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">What&apos;s wrong with it?</span>
        <span className="relative">
          <select value={rule} onChange={(e) => setRule(e.target.value)} required className={`${FIELD} h-11 appearance-none pr-9`}>
            <option value="" disabled className="bg-[#111]">
              Choose a rule…
            </option>
            {REVIEW_RULE_IDS.map((id) => (
              <option key={id} value={id} className="bg-[#111]">
                {REVIEW_RULES[id].title}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-white/50" />
        </span>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Anything we should know? <span className="font-normal text-white/50">(optional)</span>
        </span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX}
          rows={3}
          className="border-white/15 bg-white/5 text-white placeholder:text-white/40 dark:bg-white/5"
        />
      </label>

      {email ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={updates} onChange={(e) => setUpdates(e.target.checked)} className="mt-1 size-4 accent-white" />
            <span>
              <span className="text-sm font-medium">Receive updates by email</span>
              <span className="block text-[13px] text-white/55">Only about this report, as far as the law allows us to share.</span>
            </span>
          </label>
          {updates ? (
            <div className="flex flex-col gap-1.5 pl-6.5">
              <label htmlFor="report-email" className="text-[13px] text-white/65">
                We&apos;ll write to
              </label>
              <input id="report-email" type="email" value={email} readOnly aria-readonly="true" className={`${FIELD} h-11 border-white/10 text-white/75`} />
              <span className="text-xs text-white/50">
                To use another address, change it in{' '}
                <Link href="/account/security" className="underline underline-offset-4 hover:text-white">
                  your account
                </Link>
                .
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Turnstile draws here only when Cloudflare wants a click. */}
      <div ref={turnstileRef} />

      {error ? (
        <p role="alert" className="text-sm text-(--red-9)">
          {error}
        </p>
      ) : turnstileFailed ? (
        <p role="alert" className="text-sm text-(--red-9)">
          We couldn&apos;t load the check that keeps out spam. Reload the page and try again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-white/45">Protected by Cloudflare</span>
        <Button type="submit" disabled={pending || !token} className="ml-auto h-11 bg-white text-black hover:bg-white/90">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Send report
        </Button>
      </div>

      {email ? null : (
        <p className="text-[13px] text-white/55">
          Not signed in? You can still report.{' '}
          <Link href={signInHref} className="underline underline-offset-4 hover:text-white">
            Sign in
          </Link>{' '}
          to get updates.
        </p>
      )}
    </form>
  );
}
