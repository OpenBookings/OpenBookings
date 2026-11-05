import bundledManifest from "../manifest.json";
import { BACKDROP_MANIFEST_URL, parseBackdropManifest, pickBackdrop, type Backdrop } from "./backdrops";

const REVALIDATE_SECONDS = 3600;
const TIMEOUT_MS = 2000;

/**
 * Server-only. Every backdrop in the manifest. Pages that must stay cacheable
 * pass this to `useBackdrop`, which picks one in the browser.
 *
 * If the CDN manifest can't be loaded, this returns the copy bundled with the
 * app, never an empty list. The homepage is prerendered at build time, so an
 * empty list would be baked into the cached page: no photo and a bare
 * "Discover" heading until the next regeneration.
 */
export async function getBackdrops(): Promise<Backdrop[]> {
  try {
    // `next` is Next.js's fetch extension: the manifest is cached for an hour
    // and refreshed in the background. Cast because this package does not
    // depend on `next` for its types.
    const init = { next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(TIMEOUT_MS) };
    const response = await fetch(BACKDROP_MANIFEST_URL, init as RequestInit);
    if (!response.ok) return bundledBackdrops(`HTTP ${response.status}`);
    const list = parseBackdropManifest(await response.json());
    return list.length > 0 ? list : bundledBackdrops("no valid entries");
  } catch (error) {
    return bundledBackdrops(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

function bundledBackdrops(reason: string): Backdrop[] {
  console.warn(`[backdrops] CDN manifest unavailable (${reason}); using the bundled copy`);
  return parseBackdropManifest(bundledManifest);
}

/**
 * Server-only. The backdrop for this request, from the id in the visitor's
 * cookie. When `persist` is true, render `<RememberBackdrop>` so the browser
 * stores the new pick.
 *
 * Reading the cookie makes the page per-visitor, so only use this on pages
 * that are dynamic anyway. Public pages use `getBackdrops` + `useBackdrop`.
 */
export async function getBackdrop(storedId: string | undefined): Promise<{ backdrop: Backdrop | null; persist: boolean }> {
  return pickBackdrop(await getBackdrops(), storedId);
}
