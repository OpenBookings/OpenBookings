const TIMEOUT_MS = 3000;
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export interface RefreshEnv {
  /** The guest site's origin, e.g. https://openbookings.co. */
  webUrl?: string;
  /** Shared with apps/web; authorises POST /api/revalidate there. */
  revalidateSecret?: string;
  cloudflareZoneId?: string;
  /** API token with only the Zone → Cache Purge permission. */
  cloudflarePurgeToken?: string;
}

export interface RefreshDeps {
  env?: RefreshEnv;
  fetch?: typeof fetch;
  onError?: (error: unknown, phase: "revalidate" | "cdn-purge") => void;
}

function readEnv(): RefreshEnv {
  return {
    webUrl: process.env.NEXT_PUBLIC_WEB_URL,
    revalidateSecret: process.env.REVALIDATE_SECRET,
    cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID,
    cloudflarePurgeToken: process.env.CLOUDFLARE_PURGE_TOKEN,
  };
}

async function post(doFetch: typeof fetch, url: string, token: string, body: unknown) {
  const response = await doFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
}

/**
 * Make guests see a saved listing now, not when the caches expire. Run it
 * after the Redis copy is purged, because both steps below re-read the page:
 *
 * 1. The guest app rebuilds its cached page (Next.js ISR) from fresh data.
 * 2. Cloudflare drops its copy, so the next visitor fetches the rebuilt one.
 *
 * The order matters: purging Cloudflare first would let it re-cache the old
 * page from the guest app in between.
 *
 * Each step is skipped when its env vars are unset (local dev), and nothing
 * here throws: the save has already committed, so a failure costs a page
 * that is stale for up to five minutes, never a save reported as failed.
 */
export async function refreshPublicPropertyPage(slug: string, deps: RefreshDeps = {}): Promise<void> {
  const env = deps.env ?? readEnv();
  const doFetch = deps.fetch ?? fetch;
  const onError = deps.onError ?? (() => {});
  if (!env.webUrl) return;

  const origin = env.webUrl.replace(/\/+$/, "");
  const path = `/p/${slug}`;

  if (env.revalidateSecret) {
    try {
      await post(doFetch, `${origin}/api/revalidate`, env.revalidateSecret, { paths: [path] });
    } catch (error) {
      onError(error, "revalidate");
    }
  }

  if (env.cloudflareZoneId && env.cloudflarePurgeToken) {
    try {
      await post(
        doFetch,
        `${CLOUDFLARE_API}/zones/${env.cloudflareZoneId}/purge_cache`,
        env.cloudflarePurgeToken,
        { files: [`${origin}${path}`] },
      );
    } catch (error) {
      onError(error, "cdn-purge");
    }
  }
}
