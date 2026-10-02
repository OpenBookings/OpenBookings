import type { ConsentEvent } from "./consent-events";

/**
 * Outbox for consent events.
 *
 * The visitor's choice takes effect on the device the moment they make it;
 * telling the server is evidence, and must never hold the UI up or be lost to
 * a dropped connection. So events are written here first and delivered when
 * the network allows, oldest first, each with an idempotency key so a retry
 * can never be recorded twice.
 *
 * Storage and fetch are passed in: browsers can refuse localStorage outright
 * (private windows, blocked site data), and every access is guarded so that a
 * refusal costs the evidence, never the page.
 */

export const OUTBOX_KEY = "ob_consent_outbox";
const MAX_QUEUED = 20;

export type OutboxDeps = {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** Narrower than `typeof fetch` on purpose: it is all the outbox needs. */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  endpoint: string;
  /** Called when the server rejects an event for good (a 4xx other than 429). */
  onDrop?: (event: ConsentEvent, status: number) => void;
};

function read(deps: OutboxDeps): ConsentEvent[] {
  try {
    const raw = deps.storage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConsentEvent[]) : [];
  } catch {
    return [];
  }
}

function write(deps: OutboxDeps, events: ConsentEvent[]): void {
  try {
    deps.storage.setItem(OUTBOX_KEY, JSON.stringify(events));
  } catch {
    // Nothing to fall back to; see the note at the top.
  }
}

export function enqueueConsentEvent(deps: OutboxDeps, event: ConsentEvent): void {
  const queue = [...read(deps), event];
  write(deps, queue.slice(-MAX_QUEUED));
}

// One flush at a time per page. Two would each read the same head of the
// queue and send it twice; the server would dedupe, but there is no reason to.
let flushing: Promise<{ expiresAt: string | null; remaining: number }> | null = null;

export function flushConsentOutbox(
  deps: OutboxDeps,
): Promise<{ expiresAt: string | null; remaining: number }> {
  if (flushing) return flushing;
  flushing = run(deps).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function run(deps: OutboxDeps) {
  let expiresAt: string | null = null;

  for (;;) {
    const queue = read(deps);
    const head = queue[0];
    if (!head) return { expiresAt, remaining: 0 };

    let res: Response;
    try {
      res = await deps.fetch(deps.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        // Lets the request finish if the visitor navigates right after choosing.
        keepalive: true,
        body: JSON.stringify(head),
      });
    } catch {
      return { expiresAt, remaining: queue.length };
    }

    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { expiresAt?: unknown } | null;
      if (typeof body?.expiresAt === "string") expiresAt = body.expiresAt;
    } else if (res.status === 429 || res.status >= 500) {
      // Try again later, in order. Stopping here keeps older events ahead of
      // newer ones, which is what makes the log read as a history.
      return { expiresAt, remaining: queue.length };
    } else {
      // A malformed event will never be accepted; keeping it would block
      // everything queued behind it.
      deps.onDrop?.(head, res.status);
    }

    // Re-read before removing: an event may have been queued while this one
    // was in flight.
    write(
      deps,
      read(deps).filter((e) => e.idempotencyKey !== head.idempotencyKey),
    );
  }
}
