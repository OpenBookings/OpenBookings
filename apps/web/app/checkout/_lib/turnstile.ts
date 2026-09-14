/**
 * Cloudflare Turnstile verification for the checkout Session route.
 *
 * Canonical siteverify, per developers.cloudflare.com/turnstile/spin: the
 * browser never talks to Cloudflare's verify endpoint — it sends its token to
 * us, and we exchange it server-side with the secret. The widget on the page
 * proves nothing on its own; this call is what actually gates the request.
 *
 * Three things must all hold, and any one of them failing is a refusal:
 *
 *   success   — the challenge was solved and the token has not been redeemed
 *               before. Tokens are single-use, so a replayed one fails here.
 *   action    — matches the surface the widget was embedded on, so a token
 *               minted by some other Turnstile widget on our sitekey cannot be
 *               spent against checkout.
 *   hostname  — the frontend host that produced the token is one we approved.
 *               One widget is registered for both local and production
 *               domains, so without this check a token solved on localhost
 *               would be spendable against production.
 *
 * Turnstile has no reCAPTCHA-style score: the answer is a boolean.
 */

/** The surface this token must have been minted for. */
export const TURNSTILE_ACTION = 'checkout';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's tokens are well under this; the cap just bounds what we forward. */
const MAX_TOKEN_LENGTH = 2048;

const VERIFY_TIMEOUT_MS = 10_000;

type SiteverifyResponse = {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
};

/**
 * Frontend hostnames whose tokens this deployment accepts, from
 * `TURNSTILE_HOSTNAMES` (comma-separated).
 *
 * Deployment-specific on purpose. A production value must not contain
 * `localhost` or `127.0.0.1` — those belong on the widget (so the local dev
 * server can render it) but never in a production allowlist.
 *
 * Read per call rather than at module load: an empty or missing value must
 * fail every request rather than be captured once at import and silently
 * define the behaviour of a misconfigured deploy.
 */
function expectedHostnames(): Set<string> {
  return new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );
}

/**
 * True when `token` is a valid, unredeemed Turnstile token for this action and
 * an approved hostname.
 *
 * Fails closed on everything: a missing secret, an unconfigured allowlist, a
 * network failure, a non-2xx from Cloudflare, or a malformed body all return
 * false. An outage at Cloudflare therefore blocks checkout rather than opening
 * it — the safer direction for an endpoint that creates Stripe Sessions, and
 * the caller reports it to the guest as a retryable failure.
 */
export async function verifyTurnstileToken(
  token: unknown,
  clientIp: string | null
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  const hostnames = expectedHostnames();

  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    hostnames.size === 0 ||
    !secret
  ) {
    return false;
  }

  const body = new URLSearchParams({ secret, response: token });
  // Optional, and only meaningful when it is a real address. `getClientIP`
  // returns the string "unknown" when no trusted header is present, and
  // sending that would make Cloudflare reject an otherwise valid token.
  if (clientIp && clientIp !== 'unknown') {
    body.set('remoteip', clientIp);
  }

  let result: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      body,
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return false;
  }

  return (
    result.success === true &&
    result.action === TURNSTILE_ACTION &&
    typeof result.hostname === 'string' &&
    hostnames.has(result.hostname)
  );
}
