/**
 * Cloudflare Turnstile verification, for every surface that runs the widget:
 * the checkout Session route and the public review report form. Each surface
 * mints its tokens with its own action (TURNSTILE_ACTIONS), and a token is
 * only accepted for the action it was minted for.
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
 *               minted on one surface (the report form) cannot be spent
 *               against another (checkout).
 *   hostname  — the frontend host that produced the token is one we approved.
 *               One widget is registered for both local and production
 *               domains, so without this check a token solved on localhost
 *               would be spendable against production.
 *
 * Turnstile has no reCAPTCHA-style score: the answer is a boolean.
 */

import type { TurnstileAction } from './turnstile-actions';

export { TURNSTILE_ACTIONS, type TurnstileAction } from './turnstile-actions';

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
function expectedHostnames(value = process.env.TURNSTILE_HOSTNAMES): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );
}

/** Seams for the tests; production reads the environment and calls Cloudflare. */
export type TurnstileDeps = {
  secret?: string;
  hostnames?: string;
  fetchFn?: typeof fetch;
};

/**
 * True when `token` is a valid, unredeemed Turnstile token for `action` and
 * an approved hostname.
 *
 * Fails closed on everything: a missing secret, an unconfigured allowlist, a
 * network failure, a non-2xx from Cloudflare, or a malformed body all return
 * false. An outage at Cloudflare therefore blocks the request rather than
 * opening it: checkout reports it to the guest as a retryable failure, the
 * report form asks them to try again.
 */
export async function verifyTurnstile(
  token: unknown,
  clientIp: string | null,
  action: TurnstileAction,
  deps: TurnstileDeps = {}
): Promise<boolean> {
  const secret = 'secret' in deps ? deps.secret : process.env.TURNSTILE_SECRET;
  const hostnames = expectedHostnames('hostnames' in deps ? deps.hostnames : process.env.TURNSTILE_HOSTNAMES);
  const fetchFn = deps.fetchFn ?? fetch;

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
    const response = await fetchFn(SITEVERIFY_URL, {
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
    result?.success === true &&
    result.action === action &&
    typeof result.hostname === 'string' &&
    hostnames.has(result.hostname)
  );
}
