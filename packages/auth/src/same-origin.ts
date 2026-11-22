/**
 * CSRF guard for the cookie-authenticated API route handlers of both apps.
 *
 * Session cookies are SameSite=Lax, which stops other sites but not sibling
 * subdomains: any page on *.openbookings.co (or the apex) is "same-site", so a
 * browser attaches the session cookie to its POSTs. Route handlers parse JSON
 * whatever the Content-Type, so a CORS-simple text/plain or multipart POST
 * would run as the signed-in user. This refuses those requests.
 *
 * Runs first thing in each app's proxy.ts for /api/*. Same rule as
 * /api/consent (packages/analytics/src/consent-route.ts):
 *
 *  - `Sec-Fetch-Site` is set by the browser and cannot be forged by page
 *    script, so when present it decides: only `same-origin` passes.
 *  - Otherwise (older browsers) an `Origin`, when sent, must name the host the
 *    request was addressed to. That host is `x-forwarded-host` before `host`:
 *    behind the production proxy the request URL is the container's bind
 *    address, never the public origin.
 *  - A request with neither header is not a browser being steered by another
 *    page, and passes. So does one with no cookie: without the ambient
 *    session there is nothing to forge. That covers webhooks, cron and the
 *    server-to-server calls, which authenticate with their own secrets.
 *
 * Not checked:
 *  - GET/HEAD/OPTIONS: reads, and must stay free of side effects.
 *  - `/api/auth/*`: better-auth checks origins against trustedOrigins itself,
 *    and Apple's sign-in callback is a legitimate cross-site form POST.
 *  - Paths outside /api: server actions get Next's own Origin check.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function exempt(method: string, pathname: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (!pathname.startsWith("/api/")) return true;
  return pathname.startsWith("/api/auth/");
}

/** Whether this request came from one of this app's own pages. */
export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";

  const origin = headers.get("origin");
  if (!origin) return true;

  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * A 403 for a state-changing API request that another origin made with the
 * user's cookies, or null to let it through.
 */
export function csrfRefusal(method: string, pathname: string, headers: Headers): Response | null {
  if (exempt(method, pathname)) return null;
  if (!headers.get("cookie")) return null;
  if (isSameOriginRequest(headers)) return null;
  return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
