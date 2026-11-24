import { AriBatchSchema } from "@openbookings/apps-contract";
import { getPool } from "@openbookings/db";
import { applyAriBatch } from "@openbookings/db/apps";
import { appsJson, authenticateApp, firstIssue, readBodyText, unauthorized } from "@/lib/apps/api-auth";

export const dynamic = "force-dynamic";

/**
 * A body this large is refused before it is parsed: the contract's 5000-change
 * limit is checked only after zod has parsed every element.
 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const UNIQUE_VIOLATION = "23505";

/**
 * Availability, rates and restrictions from the app. 200 with the nights
 * written; 422 when a code is unknown (the whole batch is refused); 400 for a
 * malformed body; 413 for one over 10 MB.
 *
 * Stored rows get `received_at = min(batch.receivedAt, now)`: the earliest time
 * the app received any message merged into the batch (never later than now, so
 * a fast clock cannot claim the future). The availability rule compares it
 * with delivery acknowledgements.
 */
export async function POST(request: Request) {
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
  const parsed = AriBatchSchema.safeParse(json);
  if (!parsed.success) return appsJson({ error: firstIssue(parsed.error) }, 400);

  const serverNow = new Date();
  const received = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : serverNow;
  const now = received < serverNow ? received : serverNow;

  try {
    const result = await applyAriBatch(getPool(), installation, parsed.data, now);
    return appsJson(result, result.ok ? 200 : 422);
  } catch (error) {
    // Two batches inserting the same new night at once: the app retries.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return appsJson({ error: "conflict, retry" }, 503, { "Retry-After": "1" });
    }
    throw error;
  }
}
