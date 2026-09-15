import { NextResponse } from "next/server";
import { query } from "@openbookings/db";

export const dynamic = "force-dynamic";

/**
 * Guest-PII retention (task 15). Redacts guest-authored free text on
 * bookings that ended long ago — booking financials stay untouched (DAC7
 * needs them), but notes and cancellation reasons are contact-detail-shaped
 * PII with no retention justification.
 *
 * Cloud Scheduler target, same pattern as messaging-retention:
 *
 *   gcloud scheduler jobs create http pii-retention \
 *     --schedule="30 3 * * *" \
 *     --uri="https://<business-app-url>/api/cron/pii-retention" \
 *     --http-method=POST \
 *     --headers="Authorization=Bearer ${CRON_SECRET}"
 */
const RETENTION_MONTHS = Number(process.env.PII_RETENTION_MONTHS ?? 18);

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redacted = await query<{ id: string }>(
    `UPDATE bookings
     SET guest_notes = NULL,
         cancellation_reason = NULL,
         updated_at = NOW()
     WHERE check_out_date < NOW() - ($1 || ' months')::interval
       AND (guest_notes IS NOT NULL OR cancellation_reason IS NOT NULL)
     RETURNING id`,
    [String(RETENTION_MONTHS)],
  );

  return NextResponse.json({ ok: true, redactedBookings: redacted.length });
}
