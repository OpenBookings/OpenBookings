/**
 * Resolves a user-supplied `?redirect=` value to a same-origin path.
 *
 * Anything that would leave our origin falls back to `fallback`. A leading
 * `//` — or `/\`, which browsers normalise to `//` — makes the browser read
 * the value as a protocol-relative URL and send the user to an attacker's
 * host, which is what turns a post-login redirect into a phishing primitive.
 * Parsing against a placeholder base applies the same normalisation the
 * browser would, so those forms surface as a foreign origin instead of having
 * to be pattern-matched one by one.
 */
export function safeRedirectPath(target: string | undefined | null, fallback: string): string {
  if (!target) return fallback;
  const base = "https://redirect.invalid";
  try {
    const url = new URL(target, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
