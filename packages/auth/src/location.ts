/**
 * Approximate sign-in location from Cloudflare's geolocation headers. No
 * third-party lookup: the IP never leaves our infrastructure, and there's no
 * extra latency on the sign-in path.
 *
 * `cf-ipcountry` is sent whenever IP Geolocation is on. City, region and
 * timezone only arrive with the "Add visitor location headers" Managed
 * Transform enabled on the zone; without it, this degrades to country-only.
 *
 * Like `cf-connecting-ip`, these are only trustworthy while the origin is
 * reachable solely through Cloudflare (see IP_ADDRESS_HEADERS in shared.ts).
 */
export type SignInLocation = {
  city: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2, or "T1" for Tor exit nodes. */
  countryCode: string | null;
  /** IANA zone, e.g. "Europe/Amsterdam". */
  timezone: string | null;
};

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value ? value : null;
}

export function locationFromHeaders(
  headers: Headers | null | undefined,
): SignInLocation | null {
  if (!headers) return null;
  const country = header(headers, "cf-ipcountry")?.toUpperCase() ?? null;
  const location: SignInLocation = {
    city: header(headers, "cf-ipcity"),
    region: header(headers, "cf-region"),
    // "XX" is Cloudflare's "no country data".
    countryCode: country === "XX" ? null : country,
    timezone: header(headers, "cf-timezone"),
  };
  const hasPlace = location.city || location.region || location.countryCode;
  return hasPlace ? location : null;
}
