import { messagingRoutes } from "@/lib/messaging";

export const dynamic = "force-dynamic";

/**
 * Cloud Scheduler target (handler logic lives in @openbookings/messaging).
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
export const POST = messagingRoutes.runRetention;
