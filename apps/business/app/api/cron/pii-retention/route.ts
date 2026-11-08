import { NextResponse } from "next/server";
import { query } from "@openbookings/db";
import { bearerAuthorized } from "@openbookings/messaging/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Guest-PII retention (task 15). Redacts guest-authored free text on
 * bookings that ended long ago — booking financials stay untouched (DAC7
 * needs them), but notes and cancellation reasons are contact-detail-shaped
 * PII with no retention justification.
 *
 * It only ever updates two columns of `bookings`. It never reads or writes the
 * billing tables (`billing_profiles`, `commission_entries`, `invoices`,
 * `invoice_sequences`, `invoice_runs`): those are fiscal records, kept 7 years
 * as a legal obligation and left out of every deletion run (see
 * docs/privacy/data-map.md, 2.4a). Keep it that way.
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
  // Constant-time: `!==` would leak the secret's prefix through response timing.
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
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
