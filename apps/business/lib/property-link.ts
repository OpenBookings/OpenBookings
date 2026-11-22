import { setCurrentProperty } from "@openbookings/authz";

/** True for Next/browser prefetches, which must never change state. */
export function isPrefetch(headers: Headers): boolean {
  return (
    headers.has("next-router-prefetch") ||
    headers.get("purpose") === "prefetch" ||
    headers.get("sec-purpose")?.includes("prefetch") === true
  );
}

type Deps = { setCurrentProperty?: typeof setCurrentProperty };

/**
 * `?property=<id>` deep links under /dashboard. Applies the switch (a refusal
 * is ignored: the user stays on their current hotel) and returns the same URL
 * without the `property` param, or null when there is nothing to do. Every
 * other param and the path are kept.
 *
 * A prefetch passes through untouched (no switch, no redirect): Next prefetches
 * in-view links and a prefetch must not change the session's hotel.
 *
 * A plain GET from an email or external link switching hotels is intentional;
 * access is still checked by setCurrentProperty.
 */
export async function propertyLinkRedirect(
  url: URL,
  ptr: { userId: string; sessionId: string },
  deps: Deps = {},
  headers: Headers = new Headers(),
): Promise<URL | null> {
  if (!(url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/"))) return null;
  if (!url.searchParams.has("property")) return null;
  if (isPrefetch(headers)) return null;
  const id = url.searchParams.get("property") ?? "";
  try {
    await (deps.setCurrentProperty ?? setCurrentProperty)(ptr, id);
  } catch (error) {
    console.error("[property-link] switch failed:", error instanceof Error ? error.message : error);
  }
  const next = new URL(url);
  next.searchParams.delete("property");
  return next;
}
