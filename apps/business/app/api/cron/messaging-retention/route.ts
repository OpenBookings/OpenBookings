import { query } from "@openbookings/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_DAYS = 365;

/**
 * Cloud Scheduler target, not a user-facing route: no Better Auth session
 * exists for a scheduler call, so this checks a static shared secret
 * instead. First cron endpoint in the repo — no existing pattern to follow,
 * so this establishes one: an `Authorization: Bearer <CRON_SECRET>` header,
 * checked in-handler (the Cloud Run service is --allow-unauthenticated for
 * all routes, so IAM/OIDC can't gate this one route on its own without
 * splitting services).
 *
 * Configure the Cloud Scheduler job with an HTTP target pointing at this
 * route's URL, method POST, and a header `Authorization: Bearer <CRON_SECRET>`
 * matching the CRON_SECRET env var set on this Cloud Run service. Example:
 *
 *   gcloud scheduler jobs create http messaging-retention \
 *     --schedule="0 3 * * *" \
 *     --uri="https://<business-app-url>/api/cron/messaging-retention" \
 *     --http-method=POST \
 *     --headers="Authorization=Bearer ${CRON_SECRET}"
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Retention window defaults to 365 days (the 12-month commission liability
 * cap). Threads whose last activity (updated_at — bumped on every new
 * message, for both booking-scoped and pre-booking-inquiry threads) is
 * older than the window get their messages anonymized: sender_id is NULL'd
 * (see migration 0004) and body replaced with a placeholder. flagged_reason
 * and all message_threads metadata are left intact for audit purposes.
 * Idempotent: only touches rows that aren't already anonymized
 * (sender_id IS NOT NULL), so re-running is safe.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const retentionDays = Number(process.env.MESSAGE_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;

  const anonymized = await query<{ id: string }>(
    `UPDATE messages m
     SET sender_id = NULL, body = '[message removed — retention period expired]'
     FROM message_threads t
     WHERE m.thread_id = t.id
       AND m.sender_id IS NOT NULL
       AND t.updated_at < now() - make_interval(days => $1)
     RETURNING m.id`,
    [retentionDays],
  );

  return NextResponse.json({ anonymizedCount: anonymized.length, retentionDays });
}
