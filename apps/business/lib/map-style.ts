/**
 * The one place the map tile vendor is decided. MapTiler is the only vendor:
 * when its configuration is missing the map shows a placeholder rather than
 * falling back to another provider, because every tile vendor sees the
 * visitor's IP address and has to be listed in the privacy policy.
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
