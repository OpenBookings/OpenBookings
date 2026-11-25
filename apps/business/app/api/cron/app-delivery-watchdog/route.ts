import { NextResponse } from "next/server";
import { getPool } from "@openbookings/db";
import { flagUnconfirmedDeliveries, unmailedAlerts } from "@openbookings/db/apps";
import { bearerAuthorized } from "@openbookings/messaging/cron-auth";
import { alertDeliveryNeedsAttention } from "@/lib/apps/delivery-alert";

export const dynamic = "force-dynamic";

/** Older unmailed alerts mailed per run, on top of the ones flagged in it: well inside a request's time. */
const MAILS_PER_RUN = 50;

/**
 * Delivery watchdog for connected apps (SiteMinder): no booking may fail to
 * reach the hotel without anyone hearing about it.
 *
 *   1. A booking the app should have confirmed by now (its last change, or
 *      the connection, is over 30 minutes old) but has not becomes "needs
 *      attention", and the hotel is emailed (we get a Sentry warning).
 *   2. A "needs attention" whose email never went out (the process stopped
 *      between storing the app's report and mailing, or the mail failed) is
 *      emailed now, up to MAILS_PER_RUN a run.
 *
 * Each row is claimed right before its own email (`mailed_at`), so each move
 * into "needs attention" is emailed once and a run cut short loses nothing.
 * Schedule it every 5 minutes, like the other jobs:
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
  const flagged = await flagUnconfirmedDeliveries(db, now);
  const older = await unmailedAlerts(db, now, MAILS_PER_RUN);
  let mailed = 0;
  let failed = 0;
  for (const row of [...flagged, ...older]) {
    const outcome = await alertDeliveryNeedsAttention(db, row, now);
    if (outcome === "sent") mailed += 1;
    if (outcome === "failed") failed += 1;
  }
  return NextResponse.json({ ok: true, flagged: flagged.length, mailed, failed });
}
