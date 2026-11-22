/**
 * Keeps bearer tokens that live in page URLs out of telemetry: review links
 * and sign-in link tokens (`?token=`).
 *
 * The emailed review link is /review/<token> (and /review/<token>/stop), and
 * the token alone lets whoever holds it post the guest's review. Browsers put
 * that URL into location.href, so PostHog ($current_url, $pathname, $referrer,
 * $initial_* ...) and Sentry (request.url, breadcrumbs, span url attributes)
 * would otherwise store it. Every string in an outgoing payload goes through
 * redactUrl, which swaps the token for "[token]".
 *
 * Dependency-free on purpose: imported by the browser, Node and edge Sentry
 * configs as well as the PostHog client.
 */

// `/review/` (or its percent-encoded form) followed by a token segment. The
// token is base64url, so "[token]" itself never matches and redaction is
// idempotent; the route /bookings/<ref>/review has nothing after "review".
const REVIEW_TOKEN = /(\/|%2F)review(\/|%2F)[A-Za-z0-9_-]+/gi;

// A `token` query parameter, plain or percent-encoded inside another URL: the
// magic-link verify URL and its confirm pages (/auth/confirm, /login/confirm)
// carry a single-use sign-in token there.
const TOKEN_PARAM = /([?&]|%3F|%26)token(=|%3D)[^&#\s"'%]+/gi;

export function redactUrl(value: string): string {
  return value.replace(REVIEW_TOKEN, "$1review$2[token]").replace(TOKEN_PARAM, "$1token$2[token]");
}

// Payloads are small JSON-ish trees; anything deeper is not ours to walk.
const MAX_DEPTH = 64;

// SDK-internal bookkeeping (scopes, raw requests) that is never sent as-is.
const SKIP_KEYS = new Set(["sdkProcessingMetadata"]);

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return redactUrl(value);
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const next = walk(value[i], seen, depth + 1);
      if (next !== value[i]) value[i] = next;
    }
    return value;
  }
  // Leave class instances (Date, Error, Scope, DOM nodes) alone.
  if (!isPlain(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SKIP_KEYS.has(key)) continue;
    const next = walk(record[key], seen, depth + 1);
    if (next !== record[key]) {
      try {
        record[key] = next;
      } catch {
        // Frozen or read-only: nothing we can do, and telemetry must not throw.
      }
    }
  }
  return value;
}

/**
 * Redacts every string in `value`, in place for objects and arrays. Returns
 * the same reference (or the redacted string), so it can be handed straight to
 * PostHog's `before_send` and Sentry's `beforeSend*` hooks.
 */
export function redactDeep<T>(value: T): T {
  try {
    return walk(value, new WeakSet(), 0) as T;
  } catch {
    return value;
  }
}

/** Spread into Sentry.init: errors, streamed spans and breadcrumbs all pass through redactDeep. */
export const sentryRedaction = {
  beforeSend: redactDeep,
  beforeSendSpan: redactDeep,
  beforeBreadcrumb: redactDeep,
};
