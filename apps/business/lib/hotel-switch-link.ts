/**
 * True for a link that carries `?property=`: following it switches the
 * current hotel (the proxy applies the switch and redirects, see
 * lib/property-link.ts). Client-safe: no server imports.
 *
 * Such a link must be a plain `<a href>`, never next/link or router.push. A
 * soft navigation keeps the (dashboard) layout, so the sidebar, the greyed-out
 * menu and the stale-tab watch would stay on the old hotel while the page shows
 * the new one. A full document load renders everything on the new hotel.
 */
export function switchesHotel(href: string): boolean {
  const start = href.indexOf("?");
  if (start < 0) return false;
  const end = href.indexOf("#", start);
  const search = href.slice(start + 1, end < 0 ? undefined : end);
  return new URLSearchParams(search).has("property");
}
