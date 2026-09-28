/**
 * Validation for caller-supplied "where to go after sign-in" values.
 *
 * Lives in its own module rather than inside the route because it is the whole
 * of an open-redirect defence, and a defence that cannot be tested in
 * isolation tends not to be tested at all.
 *
 * Two exports, one rule set: `resolveCallbackURL` produces the absolute URL a
 * magic-link email needs, `resolveCallbackPath` the site-relative path a
 * same-app `redirect()` needs. Both apply the guard below, so a rule added in
 * one place covers both callers.
 */

/**
 * Returns `raw` when it is shaped like a path of ours, or null when it is not.
 *
 * Rejects the shapes that have no business in this field at all before any URL
 * parsing, so they fail on their own terms rather than relying on the parser to
 * agree with us.
 */
function asSiteRelativePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null
  // Site-relative only. A scheme, a protocol-relative "//host", or a backslash
  // (which some clients normalise to "/") all point away from us.
  if (!raw.startsWith("/")) return null
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null
  // A newline or NUL can split a header or truncate a parse further down. A
  // tab is here for the same reason the others are: the URL parser strips it
  // silently, so "/\tevil.com" would otherwise survive as "/evil.com".
  if (/[\x00-\x1f\x7f]/.test(raw)) return null
  return raw
}

/**
 * Resolves a caller-supplied post-sign-in path to an absolute URL on the
 * calling app's own origin, falling back to that origin's root for anything
 * that does not belong.
 *
 * The value arrives from the browser and ends up inside an email, as the link
 * the guest clicks. Unvalidated, that is a textbook open redirect with an
 * unusually nasty shape: the phishing link is a real OpenBookings magic link,
 * sent by us, arriving from our own domain, and it works.
 *
 * Resolving against the app's base and comparing origins is what does the real
 * work — it collapses "//evil.com", "https://evil.com", userinfo tricks like
 * "https://openbookings.co@evil.com" and encoded variants into an origin that
 * simply is not ours.
 *
 * `appUrl` is required and has no default. OpenBookings is two apps on two
 * origins — openbookings.co for guests, business.openbookings.co for hosts —
 * and they are as foreign to each other as any third party is. A default here
 * could only ever name one of them, which would mean a business-side call that
 * forgot to pass its origin silently minted a working link to the consumer
 * site. Making the parameter required moves that mistake to compile time.
 *
 * @param raw     the untrusted value, from a request body
 * @param appUrl  this deployment's own origin
 * @throws if `appUrl` is not a parseable absolute URL — a misconfigured origin
 *   is a deploy-time bug, and failing loudly beats emailing a junk link.
 */
export function resolveCallbackURL(raw: unknown, appUrl: string): string {
  // Deliberately outside the try below: a bad appUrl is our own configuration
  // error, not untrusted input, and must not be swallowed into a fallback.
  const baseOrigin = new URL(appUrl).origin

  const path = asSiteRelativePath(raw)
  if (path === null) return appUrl

  try {
    const resolved = new URL(path, appUrl)
    if (resolved.origin !== baseOrigin) return appUrl
    return resolved.toString()
  } catch {
    return appUrl
  }
}

/**
 * Resolves a caller-supplied `?redirect=` value to a site-relative path,
 * falling back to `fallback` for anything that would leave our origin.
 *
 * The counterpart to `resolveCallbackURL` for redirects that stay inside the
 * app that received the request: a `redirect()` wants "/dashboard?tab=a", not
 * an absolute URL. Because the result is always relative, this needs no app
 * origin and is safe to call from either app — parsing happens against a
 * placeholder base purely to apply the same normalisation a browser would, so
 * protocol-relative and backslash forms surface as a foreign origin instead of
 * having to be pattern-matched one by one.
 *
 * @param raw       the untrusted value, from a query parameter
 * @param fallback  the path to use when `raw` does not belong
 */
export function resolveCallbackPath(raw: unknown, fallback: string): string {
  const path = asSiteRelativePath(raw)
  if (path === null) return fallback

  const base = "https://callback.invalid"
  try {
    const url = new URL(path, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
