import { query } from "./index";

export type ConsentEventType = "granted" | "denied" | "withdrawn" | "linked";

export type ConsentEventRow = {
  consentId: string;
  eventType: ConsentEventType;
  categories: { analytics: boolean };
  bannerVersion: string;
  app: "web" | "business";
  userId: string | null;
  idempotencyKey: string;
};

/** How long a recorded decision stands before the visitor is asked again. */
const CONSENT_TTL = "90 days";

/**
 * Append one consent event. `expires_at` and `created_at` come from the
 * database clock, never from the caller.
 *
 * A repeated idempotency key writes nothing and returns the first row's
 * expiry, so a retried request gets the same answer it would have had.
 */
export async function insertConsentEvent(
  row: ConsentEventRow,
): Promise<{ expiresAt: string }> {
  const inserted = await query<{ expires_at: Date }>(
    `INSERT INTO consent_log
       (consent_id, event_type, categories, banner_version, app, user_id, idempotency_key, expires_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, now() + interval '${CONSENT_TTL}')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING expires_at`,
    [
      row.consentId,
      row.eventType,
      JSON.stringify(row.categories),
      row.bannerVersion,
      row.app,
      row.userId,
      row.idempotencyKey,
    ],
  );
  if (inserted[0]) return { expiresAt: inserted[0].expires_at.toISOString() };

  const existing = await query<{ expires_at: Date }>(
    `SELECT expires_at FROM consent_log WHERE idempotency_key = $1`,
    [row.idempotencyKey],
  );
  if (!existing[0]) throw new Error("consent_log: insert returned no row and none exists");
  return { expiresAt: existing[0].expires_at.toISOString() };
}
