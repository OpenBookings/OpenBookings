import { after } from "next/server";
import { DeliveryReportSchema } from "@openbookings/apps-contract";
import { getPool, withTransaction } from "@openbookings/db";
import { recordDelivery } from "@openbookings/db/apps";
import { alertDeliveryNeedsAttention } from "@/lib/apps/delivery-alert";
import { appsJson, authenticateApp, firstIssue, readBodyText, unauthorized } from "@/lib/apps/api-auth";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * The app's latest word on one booking: 204 when stored (or ignored, for a
 * stale report), 409 {status: "not_sent"} for a booking the hotel chose not to
 * send (the app stops delivering it), 404 for a booking that is not this
 * property's (whether it exists elsewhere is not revealed).
 */
export async function PUT(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  const installation = await authenticateApp(request);
  if (!installation) return unauthorized();

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) return appsJson({ error: "too large" }, 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return appsJson({ error: "invalid JSON" }, 400);
  }
  const parsed = DeliveryReportSchema.safeParse(json);
  if (!parsed.success) return appsJson({ error: firstIssue(parsed.error) }, 400);

  const { bookingId } = await context.params;
  // The booking row is locked FOR SHARE, so this runs in a transaction.
  const result = await withTransaction((tx) => recordDelivery(tx, installation, bookingId, parsed.data, new Date()));
  if (result.result === "unknown-booking") return appsJson({ error: "not found" }, 404);
  // The hotel chose not to send this booking (spec §3b): tell the app to stop.
  if (result.previousStatus === "not_sent") return appsJson({ status: "not_sent" }, 409);
  // Only the move into needs_attention alerts: a repeated report, or one the
  // store ignored, leaves the status as it was. After the commit, never inside
  // it, and after the 204 is on its way (the mail transport has no deadline).
  // The alert claims the row's mail first, so the watchdog job never sends it
  // twice; a mail that fails or never starts is the watchdog's to send.
  if (result.previousStatus !== "needs_attention" && result.status === "needs_attention") {
    const alert = {
      installationId: installation.id,
      bookingId,
      propertyId: installation.propertyId,
      appKey: installation.appKey,
      detail: parsed.data.detail,
    };
    after(() => alertDeliveryNeedsAttention(getPool(), alert, new Date()));
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
