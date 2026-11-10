'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { REPLY_BODY_MAX } from '@openbookings/pricing';
import { Button } from '@/components/ui/button';
import { answerHostReply } from '@/lib/reviews/actions';

/** The guest's one answer to the property's public reply. */
export function ReplyAnswerForm({ bookingId, propertyName }: { bookingId: string; propertyName: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await answerHostReply(bookingId, text);
      if (!result.ok) return setMessage(result.message);
      setText('');
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="answer" className="text-sm font-medium text-white">
        Answer {propertyName}
      </label>
      <textarea
        id="answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={REPLY_BODY_MAX}
        rows={3}
        className="w-full resize-y rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-[15px] text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-white/40"
        placeholder="Write your answer…"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white/50">Shows under your review on the property page. You can answer once.</p>
        <Button size="sm" disabled={pending || text.trim().length === 0} onClick={submit}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Post answer
        </Button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-white/75">
          {message}
        </p>
      ) : null}
    </div>
  );
}
