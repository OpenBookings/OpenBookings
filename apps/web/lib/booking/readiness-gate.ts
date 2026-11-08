import type { Queryable } from '@openbookings/db';
import { propertyReadiness, readinessEnforced } from '@openbookings/billing/readiness';

/**
 * Whether guests may book the property: it has its Stripe account, rates
 * confirmation, legal details and billing profile (spec decision 9). Always
 * true when the gate is switched off (`PROPERTY_READINESS_ENFORCE=off`).
 *
 * Stripe's own check that the account can charge is left out here: it would
 * cost a network call on every booking, and Stripe refuses a charge on an
 * account that cannot take one anyway.
 */
export async function propertyBookable(
  db: Queryable,
  propertyId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!readinessEnforced(env)) return true;
  return (await propertyReadiness(db, propertyId)).ready;
}
