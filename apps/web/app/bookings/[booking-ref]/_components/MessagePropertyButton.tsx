'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" className="self-start" disabled={pending} onClick={open}>
        <MessageSquare aria-hidden />
        {pending ? 'Opening…' : 'Message the property'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
