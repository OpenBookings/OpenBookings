const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 3000;
/** One ping per page per hour, however often the host saves it. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
/** IndexNow's own rule for a key. */
const KEY = /^[a-zA-Z0-9-]{8,128}$/;

/** When each URL was last sent, per container. Cleared on restart, which is fine. */
const lastSent = new Map<string, number>();

export interface IndexNowDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Replaces the per-container record, for tests. */
  sent?: Map<string, number>;
}

/**
 * Tell Bing and the other IndexNow engines (Yandex, Seznam, Naver…) that a
 * public page changed, so they recrawl it now rather than whenever they next
 * come by. An unpublished listing is sent too: they then find it gone.
 *
 * Skipped without a valid key or for a site that is not public https (local
 * dev). Rate saves can come in bursts, and engines throttle a site that pings
 * too often, so a URL is sent at most once an hour per container. Throws on
 * an engine error; the caller reports it and carries on.
 *
 * The engine checks the key against `<origin>/indexnow-key.txt`, which apps/web
 * serves from the same INDEXNOW_KEY.
 */
export async function notifyIndexNow(
  origin: string,
  path: string,
  key: string | undefined,
  deps: IndexNowDeps = {},
): Promise<void> {
  if (!key || !KEY.test(key)) return;
  let site: URL;
  try {
    site = new URL(origin);
  } catch {
    return;
  }
  if (site.protocol !== "https:" || site.hostname === "localhost" || site.hostname.endsWith(".localhost")) return;

  const url = `${site.origin}${path}`;
  const now = (deps.now ?? Date.now)();
  const sent = deps.sent ?? lastSent;
  const previous = sent.get(url);
  if (previous !== undefined && now - previous < MIN_INTERVAL_MS) return;
  // Recorded before sending: a burst of saves must not race several pings out.
  sent.set(url, now);

  const response = await (deps.fetch ?? fetch)(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: site.host,
      key,
      keyLocation: `${site.origin}/indexnow-key.txt`,
      urlList: [url],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 200 and 202 both mean accepted (202: key not verified yet).
  if (!response.ok) {
    // A refused ping should be retried on the next save, not an hour later.
    sent.delete(url);
    throw new Error(`IndexNow answered ${response.status}`);
  }
}
