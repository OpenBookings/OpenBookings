/**
 * Validation for caller-supplied "where to go after sign-in" values.
 *
 * Lives in its own module rather than inside the route because it is the whole
 * of an open-redirect defence, and a defence that cannot be tested in
 * isolation tends not to be tested at all.
 */

const DEFAULT_APP_URL = "https://openbookings.co"

/**
 * Resolves a caller-supplied post-sign-in path to an absolute URL on our own
 * origin, falling back to the site root for anything that does not belong.
 *
 * The value arrives from the browser and ends up inside an email, as the link
 * the guest clicks. Unvalidated, that is a textbook open redirect with an
 * unusually nasty shape: the phishing link is a real OpenBookings magic link,
 * sent by us, arriving from our own domain, and it works.
 *
 * Resolving against our base and comparing origins is what does the real work
 * — it collapses "//evil.com", "https://evil.com", userinfo tricks like
 * "https://openbookings.co@evil.com" and encoded variants into an origin that
 * simply is not ours. The explicit checks in front of it reject shapes that
 * have no business in this field at all, so they fail on their own terms
 * rather than relying on URL parsing to agree with us.
 *
 * @param raw     the untrusted value, from a request body
 * @param appUrl  this deployment's own origin
 */
export function resolveCallbackURL(raw: unknown, appUrl: string = DEFAULT_APP_URL): string {
  const base = appUrl || DEFAULT_APP_URL

  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return base
  // Site-relative only. A scheme, a protocol-relative "//host", or a backslash
  // (which some clients normalise to "/") all point away from us.
  if (!raw.startsWith("/")) return base
  if (raw.startsWith("//") || raw.startsWith("/\\")) return base
  // A newline or NUL can split a header or truncate a parse further down.
  if (/[\x00-\x1f\x7f]/.test(raw)) return base

  try {
    const resolved = new URL(raw, base)
    if (resolved.origin !== new URL(base).origin) return base
    return resolved.toString()
  } catch {
    return base
  }
}
