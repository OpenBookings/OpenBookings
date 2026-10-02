/**
 * The one place the map tile vendor is decided, shared by both apps. MapTiler
 * is the only vendor: when its configuration is missing the map shows a
 * placeholder rather than falling back to another provider, because every
 * tile vendor sees the visitor's IP address and has to be listed in the
 * privacy policy.
 */
export function maptilerStyleUrl(
  styleId: string | undefined,
  apiKey: string | undefined,
): string | null {
  const id = styleId?.trim();
  const key = apiKey?.trim();
  if (!id || !key) return null;
  return `https://api.maptiler.com/maps/${encodeURIComponent(id)}/style.json?key=${encodeURIComponent(key)}`;
}

// Referenced as literal `process.env.NEXT_PUBLIC_*` so Next inlines them into
// the client bundle; a dynamic lookup would be undefined in the browser.
export const DEFAULT_MAP_STYLE = maptilerStyleUrl(
  process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID,
  process.env.NEXT_PUBLIC_MAPTILER_API_KEY,
);

/**
 * The style for each theme, or null when either theme would have none. All or
 * nothing on purpose: a map built for one theme and missing for the other
 * would render under its own "unavailable" placeholder.
 */
export function resolveMapStyles<T>(
  styles: { light?: T | string; dark?: T | string } | undefined,
  fallback: string | null,
): { light: T | string; dark: T | string } | null {
  const light = styles?.light || fallback;
  const dark = styles?.dark || fallback;
  if (!light || !dark) return null;
  return { light, dark };
}

/** Address search. Null without a key: the request could only fail. */
export function maptilerGeocodingUrl(
  query: string,
  apiKey: string | undefined,
): string | null {
  const key = apiKey?.trim();
  if (!key) return null;
  return `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&types=address&limit=5&language=en`;
}
