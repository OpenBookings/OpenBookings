import { query } from "./index";

/**
 * Which Stripe events have been handled, for webhook idempotency.
 *
 * `processed_events` is shared with the support bot's Chatwoot ledger, hence
 * the `stripe:` prefix on the id. Both apps' Stripe endpoints write here under
 * the same id, so the two must subscribe to different event types.
 */
const key = (eventId: string) => `stripe:${eventId}`;

export async function isStripeEventProcessed(eventId: string): Promise<boolean> {
  const rows = await query<{ event_id: string }>(`SELECT event_id FROM processed_events WHERE event_id = $1`, [
    key(eventId),
  ]);
  return rows.length > 0;
}

/** Called only after the event's work has succeeded. */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await query(`INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING`, [key(eventId)]);
}
