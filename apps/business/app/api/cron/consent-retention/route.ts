import { NextResponse } from "next/server";
import { query } from "@openbookings/db";
import { bearerAuthorized } from "@openbookings/messaging/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Consent-record retention. The Privacy Policy keeps consent records (the
 * cookie choices in `consent_log`) for 5 years as proof of the choice made;
 * after that they are deleted, here. The table is append-only otherwise: rows
 * are never updated except to null `user_id` on account deletion, and they
 * outlive the account as evidence until this job removes them.
 *
 * It only ever deletes from `consent_log`, by `created_at`. Keep it that way.
 *
 * Cloud Scheduler target, same pattern as pii-retention:
 *
 *   gcloud scheduler jobs create http consent-retention \
 *     --schedule="0 4 * * *" \
 *     --uri="https://<business-app-url>/api/cron/consent-retention" \
 *     --http-method=POST \
 *     --headers="Authorization=Bearer ${CRON_SECRET}"
 */
const CONSENT_RETENTION_YEARS = 5;

export async function POST(request: Request) {
  // Constant-time: `!==` would leak the secret's prefix through response timing.
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await query<{ id: string }>(
    `DELETE FROM consent_log
     WHERE created_at < NOW() - make_interval(years => $1)
     RETURNING id`,
    [CONSENT_RETENTION_YEARS],
  );

  return NextResponse.json({ ok: true, deletedConsentRecords: deleted.length, retentionYears: CONSENT_RETENTION_YEARS });
}
