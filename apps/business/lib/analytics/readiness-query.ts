import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { addDays } from "./period";
import { evaluateReadiness, NOT_STARTED, type ReadinessItem } from "./readiness";
import type { IsoDate } from "./types";

interface HostRow {
  id: string;
  is_active: boolean;
  stripe_account_id: string | null;
}

/**
 * The one place analytics reads real data, and the one place a property is
 * looked up. It is found from the signed-in user and never from the request.
 */
export async function getReadiness(userId: string, today: IsoDate): Promise<ReadinessItem[]> {
  const host = await queryOne<HostRow>(
    `SELECT p.id,
            p.is_active,
            COALESCE(p.stripe_account_id, o.step_data->>'stripe_account_id') AS stripe_account_id
       FROM properties p
       LEFT JOIN host_onboarding o ON o.user_id = p.owner_user_id
      WHERE p.owner_user_id = $1
      ORDER BY p.created_at
      LIMIT 1`,
    [userId],
  );
  if (!host) return evaluateReadiness(NOT_STARTED);

  const [ratePlan, availability, paymentsConnected] = await Promise.all([
    queryOne<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rate_plans rp
           JOIN rooms r ON r.id = rp.room_id
          WHERE r.property_id = $1 AND r.is_active AND rp.is_active
       ) AS found`,
      [host.id],
    ),
    // Open means at least one active room has a unit to sell on at least one
    // of the next ninety days: an override wins outright, otherwise capacity
    // less blocked units, and a closure covering the date rules it out.
    queryOne<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rooms r
          CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(day)
           LEFT JOIN room_inventory ri ON ri.room_id = r.id AND ri.date = d.day::date
          WHERE r.property_id = $1
            AND r.is_active
            AND COALESCE(
                  ri.available_override,
                  COALESCE(ri.total_rooms, r.total_units) - COALESCE(ri.blocked_rooms, 0)
                ) > 0
            AND NOT EXISTS (
                  SELECT 1
                    FROM room_closures c
                   WHERE c.room_id = r.id
                     AND c.is_active
                     AND d.day::date BETWEEN c.start_date AND c.end_date
                )
       ) AS found`,
      [host.id, today, addDays(today, 89)],
    ),
    chargesEnabled(host.stripe_account_id),
  ]);

  return evaluateReadiness({
    listingLive: host.is_active,
    availabilityOpen: availability?.found ?? false,
    hasActiveRatePlan: ratePlan?.found ?? false,
    paymentsConnected,
  });
}

/** Null when Stripe could not be asked: the checklist says "Check", not "not connected". */
async function chargesEnabled(accountId: string | null): Promise<boolean | null> {
  if (!accountId) return false;
  try {
    const account = await retrieveConnectAccount(accountId);
    return account.charges_enabled ?? false;
  } catch {
    return null;
  }
}
