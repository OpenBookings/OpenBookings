/**
 * The one place the map vendor is decided, shared by both apps. TomTom is the
 * only vendor, for map tiles and for address search: when its key is missing
 * the map shows a placeholder and search stays off, rather than falling back
 * to another provider, because every vendor sees the visitor's IP address and
 * has to be listed in the privacy policy.
 */

export type MapTheme = "light" | "dark";

/** Orbis Maps style for one theme. `2.*` follows TomTom's fixes within major version 2. */
export function tomtomStyleUrl(theme: MapTheme, apiKey: string | undefined): string | null {
  const key = apiKey?.trim();
  if (!key) return null;
  return `https://api.tomtom.com/maps/orbis/assets/styles/2.*/style?apiVersion=1&key=${encodeURIComponent(key)}&map=basic_street-${theme}`;
}

// Referenced as a literal `process.env.NEXT_PUBLIC_*` so Next inlines it into
// the client bundle; a dynamic lookup would be undefined in the browser.
export const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY?.trim() ?? "";

function defaultStyles(): { light: string; dark: string } | null {
  const light = tomtomStyleUrl("light", TOMTOM_API_KEY);
  const dark = tomtomStyleUrl("dark", TOMTOM_API_KEY);
  return light && dark ? { light, dark } : null;
}

export const DEFAULT_MAP_STYLES = defaultStyles();

/**
 * Which theme's map to show. The business app has a theme provider; the guest
 * site has none and is always dark (the `dark` class on <html>), so without a
 * provider the page's class decides.
 */
export function pickMapTheme(resolvedTheme: string | undefined, documentIsDark: boolean): MapTheme {
  if (resolvedTheme === "dark" || resolvedTheme === "light") return resolvedTheme;
  return documentIsDark ? "dark" : "light";
}

/**
 * The style for each theme, or null when either theme would have none. All or
 * nothing on purpose: a map built for one theme and missing for the other
 * would render under its own "unavailable" placeholder.
 */
export function resolveMapStyles<T>(
  styles: { light?: T | string; dark?: T | string } | undefined,
  fallback: { light: string; dark: string } | null,
): { light: T | string; dark: T | string } | null {
  const light = styles?.light || fallback?.light;
  const dark = styles?.dark || fallback?.dark;
  if (!light || !dark) return null;
  return { light, dark };
}

export interface TomtomSearchParams {
  /** Comma-separated TomTom indexes, e.g. "POI,PAD,Addr,Geo". */
  idxSet: string;
  /** Comma-separated ISO 3166-1 alpha-2 codes. */
  countrySet: string;
  limit: number;
  /** Bias results towards this point. */
  lat?: number;
  lon?: number;
}

/** Fuzzy search (Search API v2). Null without a key: the request could only fail. */
export function tomtomSearchUrl(
  query: string,
  apiKey: string | undefined,
  params: TomtomSearchParams,
): string | null {
  const key = apiKey?.trim();
  if (!key) return null;
  const search = new URLSearchParams({
    key,
    idxSet: params.idxSet,
    countrySet: params.countrySet,
    limit: String(params.limit),
  });
  if (params.lat !== undefined && params.lon !== undefined) {
    search.set("lat", String(params.lat));
    search.set("lon", String(params.lon));
  }
  return `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${search}`;
}

/** The parts of a Search API result we read. */
export interface TomtomResult {
  id?: string;
  /** "POI", "Point Address", "Address Range", "Street", "Geography", … */
  type: string;
  /** For "Geography": "Country", "Municipality", "PostalCodeArea", … */
  entityType?: string;
  poi?: { name?: string; brands?: { name: string }[] };
  address: {
    streetName?: string;
    streetNumber?: string;
    /** In NL only the digits ("1072"); the full code is in extendedPostalCode. */
    postalCode?: string;
    /** "1072 LH", or a comma-separated list for a street spanning several. */
    extendedPostalCode?: string;
    municipality?: string;
    /** The postal place name, usually the city as written on an address. */
    localName?: string;
    countryCode?: string;
    freeformAddress?: string;
  };
  position?: { lat: number; lon: number };
}
