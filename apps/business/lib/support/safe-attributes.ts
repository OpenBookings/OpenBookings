/**
 * Client-supplied strings that end up as Chatwoot conversation attributes,
 * which support staff read (and click) in the agent dashboard. They are
 * triage context, not content, so they are held to the shape they are
 * supposed to have; anything else is dropped rather than passed on, because a
 * "session replay" link to somewhere else is a phishing link aimed at our own
 * staff.
 */

/** A PostHog session-replay link: https on posthog.com or a subdomain, no credentials. */
export function safeReplayUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host !== "posthog.com" && !host.endsWith(".posthog.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** An in-app path such as "/dashboard/bookings": site-relative, printable, short. */
export function safeRoute(value: string | null | undefined): string | null {
  if (!value || value.length > 200) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) return null;
  return value;
}
