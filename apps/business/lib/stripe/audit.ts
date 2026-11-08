import { query } from "@openbookings/db";
import type { StripeAuditEntry } from "@openbookings/stripe";

/**
 * Writes an audit row for a Stripe fact, tied to the organisation that owns
 * the account. One row per fact: a retried event finds the row already there.
 * Shared by the Connect webhook and the platform webhook.
 */
export async function recordStripeAudit({
  action,
  stripeAccountId,
  detail,
  dedupeKey,
}: Omit<StripeAuditEntry, "detail"> & { detail: object }): Promise<void> {
  await query(
    `INSERT INTO audit_log (action, organization_id, detail)
     SELECT $1, (SELECT organization_id FROM org_profile WHERE stripe_account_id = $2), $3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_log WHERE action = $1 AND detail->>'dedupeKey' = $4
     )`,
    [action, stripeAccountId, JSON.stringify({ ...detail, stripeAccountId, dedupeKey }), dedupeKey],
  );
}
