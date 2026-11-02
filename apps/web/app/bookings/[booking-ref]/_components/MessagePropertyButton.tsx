'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GLASS_ICON_BUTTON, Hint } from './hint';

/**
 * Opens (or reuses — the endpoint is idempotent per booking) the conversation
 * with the property, then jumps to it in the account inbox.
 */
export function MessagePropertyButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
      const data = (await res.json().catch(() => null)) as { thread?: { id: string } } | null;
      if (!res.ok || !data?.thread) throw new Error('thread');
      posthog.capture('guest_thread_opened', { from: 'booking' });
      router.push(`/account/messages?id=${encodeURIComponent(data.thread.id)}`);
    } catch {
      setError('Could not open the conversation. Try again in a moment.');
      setPending(false);
    }
  }

  return (
    <>
      <Hint label="Message the property" text="Questions about your stay or arrival?">
        <Button
          type="button"
          variant="ghost"
          aria-label="Message the property"
          className={GLASS_ICON_BUTTON}
          disabled={pending}
          onClick={open}
        >
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <MessageSquare aria-hidden />}
        </Button>
      </Hint>
      {error ? (
        <p role="alert" className="w-full basis-full text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
