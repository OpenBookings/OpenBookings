import { NextResponse } from "next/server";
import { getPool } from "@openbookings/db";
import { claimAlert, claimUnmailedAlerts, flagUnconfirmedDeliveries } from "@openbookings/db/apps";
import { bearerAuthorized } from "@openbookings/messaging/cron-auth";
import { alertDeliveryNeedsAttention } from "@/lib/apps/delivery-alert";

export const dynamic = "force-dynamic";

/**
 * Delivery watchdog for connected apps (SiteMinder): no booking may fail to
 * reach the hotel without anyone hearing about it.
 *
 *   1. A booking the app should have confirmed by now (its last change, or
 *      the connection, is over 30 minutes old) but has not becomes "needs
 *      attention", and the hotel is emailed (we get a Sentry warning).
 *   2. A "needs attention" whose email never went out (the process stopped
 *      between storing the app's report and mailing) is emailed now.
 *
 * Each move into "needs attention" is emailed once (`mailed_at`). Schedule it
 * every 5 minutes, like the other jobs:
 *
 *   gcloud scheduler jobs create http app-delivery-watchdog \
 *     --schedule="*\/5 * * * *" \
 *     --uri="https://<business-app-url>/api/cron/app-delivery-watchdog" \
 *     --http-method=POST \
 *     --headers="Authorization=Bearer ${CRON_SECRET}"
 */
export async function POST(request: Request) {
  // Constant-time: `!==` would leak the secret's prefix through response timing.
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getPool();
  const now = new Date();
  let mailed = 0;
  const flagged = await flagUnconfirmedDeliveries(db, now);
  for (const row of flagged) {
    if (!(await claimAlert(db, { installationId: row.installationId, bookingId: row.bookingId, now }))) continue;
    await alertDeliveryNeedsAttention(row);
    mailed += 1;
  }
  for (const row of await claimUnmailedAlerts(db, now)) {
    await alertDeliveryNeedsAttention(row);
    mailed += 1;
  }
  return NextResponse.json({ ok: true, flagged: flagged.length, mailed });
}
