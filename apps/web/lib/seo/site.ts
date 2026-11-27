/**
 * The guest site's public origin, without a trailing slash. Metadata,
 * canonicals, the sitemap and structured data all build absolute URLs from
 * this one value, so they always agree with each other.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co").replace(/\/+$/, "");

export const SITE_NAME = "OpenBookings";

/** `path` must start with "/". */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function propertyPath(slug: string): string {
  return `/p/${slug}`;
}

/**
 * A description for search results and link previews: whitespace collapsed,
 * cut at a word boundary near `max` characters. Search engines show about 155.
 */
export function metaDescription(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}
