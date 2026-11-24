import type { AriBatch } from "@openbookings/apps-contract";
import type { Queryable } from "./db/migrate";

/**
 * SiteMinder's inbound messages, stored before we reply and worked off by the tick. A message is
 * unprocessed until core has taken all of its changes, or until it failed for good: `processed_at` set
 * with `last_error` (a message core refused, e.g. for unknown codes).
 */

export type InboxChanges = Partial<Pick<AriBatch, "inventory" | "rates" | "restrictions">>;

/** Store one message. Its EchoToken is unique: a redelivery of a stored message is a "duplicate" and changes nothing. */
export async function storeInbound(
  db: Queryable,
  i: { installationId: string; echoToken: string; kind: string; changes: Partial<AriBatch>; now: Date },
): Promise<"stored" | "duplicate"> {
  const { rows } = await db.query(
    `INSERT INTO siteminder.inbox (installation_id, echo_token, kind, changes, received_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (echo_token) DO NOTHING
     RETURNING id`,
    [i.installationId, i.echoToken, i.kind, JSON.stringify(i.changes), i.now.toISOString()],
  );
  return rows.length > 0 ? "stored" : "duplicate";
}

export type PendingMessage = { id: string; changes: InboxChanges; receivedAt: Date; attempts: number; nextAttemptAt: Date | null };

type PendingRow = { id: string; changes: InboxChanges | null; received_at: Date; attempts: number; next_attempt_at: Date | null };

/** The installation's unprocessed messages, oldest first. */
export async function pendingMessages(db: Queryable, installationId: string, limit: number): Promise<PendingMessage[]> {
  const { rows } = await db.query<PendingRow>(
    // Order by the bigint column, not the text alias (which would sort "10" before "9").
    `SELECT b.id::text AS id, b.changes, b.received_at, b.attempts, b.next_attempt_at
       FROM siteminder.inbox b
      WHERE b.installation_id = $1 AND b.processed_at IS NULL
      ORDER BY b.id
      LIMIT $2`,
    [installationId, limit],
  );
  return rows.map((r) => ({ id: r.id, changes: r.changes ?? {}, receivedAt: r.received_at, attempts: r.attempts, nextAttemptAt: r.next_attempt_at }));
}

/** Whether the installation's oldest unprocessed message may be sent now (not waiting for a retry). */
export async function headIsDue(db: Queryable, installationId: string, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ due: boolean }>(
    `SELECT next_attempt_at IS NULL OR next_attempt_at <= $2 AS due
       FROM siteminder.inbox
      WHERE installation_id = $1 AND processed_at IS NULL
      ORDER BY id
      LIMIT 1`,
    [installationId, now.toISOString()],
  );
  return rows[0]?.due === true;
}

export async function markApplied(db: Queryable, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.query(`UPDATE siteminder.inbox SET processed_at = $2, last_error = NULL WHERE id = ANY($1::bigint[])`, [ids, now.toISOString()]);
}

/** Given up for good: kept, with the reason, but never sent again. */
export async function markFailed(db: Queryable, ids: string[], error: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE siteminder.inbox SET processed_at = $3, last_error = $2, attempts = attempts + 1 WHERE id = ANY($1::bigint[])`,
    [ids, error, now.toISOString()],
  );
}

export async function scheduleRetry(db: Queryable, ids: string[], error: string, nextAttemptAt: Date): Promise<void> {
  await db.query(
    `UPDATE siteminder.inbox SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3 WHERE id = ANY($1::bigint[])`,
    [ids, error, nextAttemptAt.toISOString()],
  );
}

/** Active installations with unprocessed messages. */
export async function installationsWithPending(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ installation_id: string }>(
    `SELECT DISTINCT b.installation_id
       FROM siteminder.inbox b JOIN siteminder.installations i ON i.id = b.installation_id
      WHERE b.processed_at IS NULL AND i.status = 'active'`,
  );
  return new Set(rows.map((r) => r.installation_id));
}

/** SiteMinder asks us to monitor queue depth and age: unprocessed messages of active installations, and the oldest one's age. */
export async function inboxHealth(db: Queryable, now: Date): Promise<{ inboxDepth: number; oldestUnprocessedSeconds: number }> {
  const { rows } = await db.query<{ depth: number; oldest: Date | null }>(
    `SELECT count(*)::int AS depth, min(b.received_at) AS oldest
       FROM siteminder.inbox b JOIN siteminder.installations i ON i.id = b.installation_id
      WHERE b.processed_at IS NULL AND i.status = 'active'`,
  );
  const row = rows[0];
  const age = row?.oldest ? Math.floor((now.getTime() - row.oldest.getTime()) / 1000) : 0;
  return { inboxDepth: row?.depth ?? 0, oldestUnprocessedSeconds: Math.max(0, age) };
}
