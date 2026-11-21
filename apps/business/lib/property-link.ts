import { setCurrentProperty } from "@openbookings/authz";

type Deps = { setCurrentProperty?: typeof setCurrentProperty };

/**
 * `?property=<id>` deep links under /dashboard. Applies the switch (a refusal
 * is ignored: the user stays on their current hotel) and returns the same URL
 * without the `property` param, or null when there is nothing to do. Every
 * other param and the path are kept.
 */
export async function propertyLinkRedirect(
  url: URL,
  ptr: { userId: string; sessionId: string },
  deps: Deps = {},
): Promise<URL | null> {
  if (!(url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/"))) return null;
  if (!url.searchParams.has("property")) return null;
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
