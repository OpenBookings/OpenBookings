import { getPool } from "@openbookings/db";
import { InvalidFeedCursorError, loadBookingChanges } from "@openbookings/db/apps";
import { appsJson, authenticateApp, unauthorized } from "@/lib/apps/api-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Booking changes after `cursor`, at most `limit` (default 50, max 200).
 * Without a cursor the response is the snapshot of every upcoming booking in
 * one page: `limit` does not apply to the snapshot.
 */
export async function GET(request: Request) {
  const installation = await authenticateApp(request);
  if (!installation) return unauthorized();

  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") || null;
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null && rawLimit !== "") {
    if (!/^\d{1,9}$/.test(rawLimit) || Number(rawLimit) < 1) return appsJson({ error: "invalid limit" }, 400);
    limit = Math.min(Number(rawLimit), MAX_LIMIT);
  }

  try {
    return appsJson(await loadBookingChanges(getPool(), installation, { cursor, limit }));
  } catch (error) {
    if (error instanceof InvalidFeedCursorError) return appsJson({ error: "invalid cursor" }, 400);
    throw error;
  }
}
