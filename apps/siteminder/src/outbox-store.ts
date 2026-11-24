import type { AppBooking } from "@openbookings/apps-contract";
import type { Queryable } from "./db/migrate";
import type { AppInstallation } from "./installations";

/** SiteMinder's UniqueID: letters and digits only, so the reference without its dashes (`OB-B7B0-2A1C` -> `OBB7B02A1C`). */
export const uniqueIdOf = (reference: string) => reference.replaceAll("-", "");

/**
 * Apply bookings from the change feed to the outbox, and optionally save the feed cursor, in ONE statement
 * (the app's db is a pool: separate queries would not share a transaction, one statement is atomic).
 *
 * - New booking: `waiting`, `unique_id` from the reference (never changed afterwards).
 * - Known booking: only a strictly higher version changes anything (`latest_version` never goes down, and a
 *   repeat of the same version is a no-op, so it cannot reopen a row that was dealt with).
 * - On a newer version these statuses go back to `waiting` with the retry state cleared: `delivered` (the
 *   channel has not been told this version), `needs_attention` (a newer version may fix what failed; the
 *   state machine puts a reopened-after-cancel booking back in needs_attention) and `retrying` (the retry was
 *   for the older version; the newer one goes out at once). `waiting` and `sending` keep their status (a send
 *   in flight sees the newer `latest_version` when it finishes) and `not_sent` stays not sent.
 */
async function applyFeed(db: Queryable, inst: AppInstallation, bookings: AppBooking[], now: Date, cursor?: string): Promise<void> {
  // One entry per booking, highest version wins (the feed sends one, but one INSERT must never touch a row twice).
  const byId = new Map<string, AppBooking>();
  for (const b of bookings) {
    const seen = byId.get(b.bookingId);
    if (!seen || b.version > seen.version) byId.set(b.bookingId, b);
  }
  const rows = [...byId.values()].map((b) => ({ id: b.bookingId, uniqueId: uniqueIdOf(b.reference), version: b.version, booking: b }));
  await db.query(
    `WITH up AS (
       INSERT INTO siteminder.outbox AS o (installation_id, booking_id, unique_id, latest, latest_version, status, updated_at)
       SELECT $1::uuid, r.id::uuid, r."uniqueId", r.booking, r.version, 'waiting', $3::timestamptz
         FROM jsonb_to_recordset($2::jsonb) AS r (id text, "uniqueId" text, version bigint, booking jsonb)
       ON CONFLICT (installation_id, booking_id) DO UPDATE SET
         latest = EXCLUDED.latest,
         latest_version = EXCLUDED.latest_version,
         status = CASE WHEN o.status IN ('delivered', 'needs_attention', 'retrying') THEN 'waiting' ELSE o.status END,
         attempts = CASE WHEN o.status IN ('delivered', 'needs_attention', 'retrying') THEN 0 ELSE o.attempts END,
         next_attempt_at = CASE WHEN o.status IN ('delivered', 'needs_attention', 'retrying') THEN NULL ELSE o.next_attempt_at END,
         last_error = CASE WHEN o.status IN ('delivered', 'needs_attention', 'retrying') THEN NULL ELSE o.last_error END,
         updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.latest_version > COALESCE(o.latest_version, -1)
       RETURNING 1
     )
     UPDATE siteminder.installations SET feed_cursor = COALESCE($4, feed_cursor) WHERE id = $1::uuid`,
    [inst.id, JSON.stringify(rows), now.toISOString(), cursor ?? null],
  );
}

/** One booking from the feed into the outbox (see `applyFeed` for the rules). */
export async function upsertFromFeed(db: Queryable, inst: AppInstallation, b: AppBooking, now: Date): Promise<void> {
  await applyFeed(db, inst, [b], now);
}

/** A whole feed page and the cursor it ends at, saved together or not at all. */
export async function savePage(db: Queryable, inst: AppInstallation, bookings: AppBooking[], nextCursor: string, now: Date): Promise<void> {
  await applyFeed(db, inst, bookings, now, nextCursor);
}

export async function feedCursor(db: Queryable, installationId: string): Promise<string | null> {
  const { rows } = await db.query<{ feed_cursor: string | null }>(`SELECT feed_cursor FROM siteminder.installations WHERE id = $1`, [installationId]);
  return rows[0]?.feed_cursor ?? null;
}

export async function markPolling(db: Queryable, installationId: string, now: Date): Promise<void> {
  await db.query(`UPDATE siteminder.installations SET last_polled_at = $2 WHERE id = $1`, [installationId, now.toISOString()]);
}

/** Active installations whose last poll is at least `pollSeconds` ago (or that were never polled). */
export async function dueForPoll(db: Queryable, now: Date, pollSeconds: number): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM siteminder.installations
      WHERE status = 'active' AND (last_polled_at IS NULL OR last_polled_at <= $1::timestamptz - make_interval(secs => $2))`,
    [now.toISOString(), pollSeconds],
  );
  return new Set(rows.map((r) => r.id));
}
