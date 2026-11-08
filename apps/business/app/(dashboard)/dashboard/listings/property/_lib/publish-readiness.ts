import type { Queryable } from "@openbookings/db";
import { propertyReadiness, readinessCopy, readinessEnforced } from "@openbookings/billing/readiness";

/**
 * Why a property cannot go live yet, in plain words for the host, or `null`
 * when it can: Stripe, rates, legal and billing details are all in place.
 * Always `null` when the gate is switched off (`PROPERTY_READINESS_ENFORCE=off`).
 *
 * `chargesEnabled` asks Stripe whether the connected account can take
 * payments; it is passed here, unlike at checkout, because publishing is rare
 * enough to afford the call.
 */
export async function publishBlocker(
  db: Queryable,
  propertyId: string,
  chargesEnabled: (accountId: string) => Promise<boolean>,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (!readinessEnforced(env)) return null;
  const { ready, missing } = await propertyReadiness(db, propertyId, { chargesEnabled });
  if (ready) return null;
  return `Before going live: ${missing.map((m) => readinessCopy(m).replace(/^./, (c) => c.toLowerCase())).join("; ")}.`;
}
