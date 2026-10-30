import { BACKDROP_MANIFEST_URL, parseBackdropManifest, pickBackdrop, type Backdrop } from "./backdrops";

const REVALIDATE_SECONDS = 3600;
const TIMEOUT_MS = 2000;

async function loadBackdrops(): Promise<Backdrop[]> {
  try {
    // `next` is Next.js's fetch extension: the manifest is cached for an hour
    // and refreshed in the background. Cast because this package does not
    // depend on `next` for its types.
    const init = { next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(TIMEOUT_MS) };
    const response = await fetch(BACKDROP_MANIFEST_URL, init as RequestInit);
    if (!response.ok) return [];
    return parseBackdropManifest(await response.json());
  } catch {
    // CDN down or slow: the pages fall back to their plain black background.
    return [];
  }
}

/**
 * Server-only. The backdrop for this request, from the id in the visitor's
 * cookie. When `persist` is true, render `<RememberBackdrop>` so the browser
 * stores the new pick.
 */
export async function getBackdrop(storedId: string | undefined): Promise<{ backdrop: Backdrop | null; persist: boolean }> {
  return pickBackdrop(await loadBackdrops(), storedId);
}
