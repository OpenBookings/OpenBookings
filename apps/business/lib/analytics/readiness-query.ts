import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { getCurrentProperty } from "@/lib/current-property";
import { createReadinessLoader } from "./readiness-loader";
import type { ReadinessItem } from "./readiness";
import type { IsoDate } from "./types";

/** The readiness checklist, wired to the real database and Stripe. */
const loadReadiness = createReadinessLoader({
  queryOne,
  retrieveAccount: retrieveConnectAccount,
});

/**
 * The checklist for the signed-in host's current hotel. The hotel comes from
 * the session (getCurrentProperty), here and nowhere else in analytics.
 */
export async function getReadiness(userId: string, today: IsoDate): Promise<ReadinessItem[]> {
  const current = await getCurrentProperty();
  return loadReadiness(userId, current?.propertyId ?? null, today);
}
