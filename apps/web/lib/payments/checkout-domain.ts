import * as Sentry from "@sentry/nextjs";
import { getRedis, type RedisLike } from "@openbookings/cache";
import { ensurePaymentMethodDomain } from "@openbookings/stripe";

/** One Stripe check per hotel per month is plenty: registrations don't lapse on their own. */
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
/** Checkout waits for this at most; a slow Stripe costs Apple Pay, never the booking. */
const DEADLINE_MS = 2500;

const cacheKey = (stripeAccountId: string, domain: string) => `pmd:v1:${stripeAccountId}:${domain}`;

/**
 * The hostname to register for Apple Pay, or null where Stripe can't register
 * one: localhost, `*.localhost` and bare IP addresses (local development).
 */
export function registrableDomain(appUrl: string): string | null {
  let host: string;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    return null;
  }
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  // IPv6 literals come back bracketed; IPv4 is four numeric labels.
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

type Deps = {
  ensure?: typeof ensurePaymentMethodDomain;
  redis?: RedisLike | null;
  report?: (err: unknown) => void;
  deadlineMs?: number;
};

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`payment domain check exceeded ${ms}ms`)), ms));
}

/**
 * Makes sure the checkout's domain is registered on the hotel's Stripe
 * account, so Apple Pay can show. Bookings are direct charges, which is why
 * this is per hotel rather than once for the platform.
 *
 * Runs beside opening the Checkout Session and never throws: anything that
 * goes wrong is reported and checkout carries on without Apple Pay.
 */
export async function ensureCheckoutDomain(stripeAccountId: string, appUrl: string, deps: Deps = {}): Promise<void> {
  const domain = registrableDomain(appUrl);
  if (!domain) return;

  const ensure = deps.ensure ?? ensurePaymentMethodDomain;
  const redis = deps.redis === undefined ? getRedis() : deps.redis;
  const report =
    deps.report ??
    ((err: unknown) =>
      Sentry.captureException(err, {
        level: "warning",
        tags: { area: "checkout", stage: "payment-domain" },
        extra: { stripeAccountId, domain },
      }));
  const key = cacheKey(stripeAccountId, domain);

  // A Redis outage only means asking Stripe again.
  const remembered = await redis?.get(key).catch(() => null);
  if (remembered) return;

  try {
    const result = await Promise.race([ensure(stripeAccountId, domain), timeout(deps.deadlineMs ?? DEADLINE_MS)]);
    if (result.applePay !== null && result.applePay !== "active") {
      report(new Error(`Apple Pay is "${result.applePay}" for ${domain} on ${stripeAccountId}`));
    }
    await redis?.set(key, "1", { ex: REMEMBER_SECONDS }).catch(() => {});
  } catch (err) {
    report(err);
  }
}
