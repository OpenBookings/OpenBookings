/**
 * The *payload shape* version, not an API version.
 *
 * Bump it when the cached value's shape changes. Every old entry is then
 * orphaned and expires on its own TTL, so a shape change is a deploy rather
 * than a migration or a manual flush — and there is never a window in which
 * new code parses an old-shaped value.
 */
export const CACHE_SCHEMA_VERSION = "v1";

/**
 * The key for one property's public listing page.
 *
 * Exported from this package, rather than spelled out at each call site,
 * because `apps/web` reads this key and `apps/business` deletes it. Two string
 * literals in two apps is exactly the kind of thing that drifts.
 *
 * The slug is lowercased because the two sides arrive at it differently: the
 * web page lowercases the URL segment, the business app reads the `slug`
 * column. Normalising here means they cannot disagree.
 */
export function propertyPageKey(slug: string): string {
  return `ob:${CACHE_SCHEMA_VERSION}:prop-page:${slug.toLowerCase()}`;
}
