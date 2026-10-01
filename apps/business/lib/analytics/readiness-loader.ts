import { addDays } from "./period";
import { evaluateReadiness, NOT_STARTED, type ReadinessItem } from "./readiness";
import type { IsoDate } from "./types";

export interface ReadinessDeps {
  queryOne: <T>(sql: string, values?: unknown[]) => Promise<T | null>;
  retrieveAccount: (accountId: string) => Promise<{ charges_enabled?: boolean | null }>;
  now?: () => number;
  /** How long the payment provider gets before the item reads "Check". */
  timeoutMs?: number;
  /** How long one host's answer is reused. */
  ttlMs?: number;
}

interface HostRow {
  id: string;
  is_active: boolean;
  stripe_account_id: string | null;
}

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_TTL_MS = 60_000;

/**
 * The one place analytics reads real data, and the one place a property is
 * looked up. It is found from the signed-in user and never from the request.
 *
 * Every host without bookings lands here on every analytics page, so the
 * answer is kept for a minute per host, and the payment provider is given a
 * deadline: a slow Stripe must not hold the page.
 */
export function createReadinessLoader(deps: ReadinessDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, { at: number; today: IsoDate; items: ReadinessItem[] }>();

  /** Null when Stripe failed or ran out of time: the checklist says "Check", not "not connected". */
  async function chargesEnabled(accountId: string | null): Promise<boolean | null> {
    if (!accountId) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      return await Promise.race([
        deps.retrieveAccount(accountId).then((account) => account.charges_enabled ?? false),
        deadline,
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(userId: string, today: IsoDate): Promise<ReadinessItem[]> {
    const host = await deps.queryOne<HostRow>(
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
      deps.queryOne<{ found: boolean }>(
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
      deps.queryOne<{ found: boolean }>(
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

  return async function getReadiness(userId: string, today: IsoDate): Promise<ReadinessItem[]> {
    const hit = cache.get(userId);
    if (hit && hit.today === today && now() - hit.at < ttlMs) return hit.items;
    const items = await load(userId, today);
    // An answer we could not get is not an answer worth keeping.
    if (items.every((item) => item.state !== "unknown")) cache.set(userId, { at: now(), today, items });
    return items;
  };
}
