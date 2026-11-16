export function linkName(destination: string, index: number): string {
  let pathname = "";
  try {
    pathname = new URL(destination).pathname;
  } catch {
    // fall through to positional naming
  }
  if (/\/stop\/?$/.test(pathname)) return "opt_out";
  return index === 0 ? "cta" : `link_${index + 1}`;
}

/**
 * Rewrites our own http(s) links to tracked URLs and adds the open pixel.
 * Only double-quoted `href="http(s)://..."` attributes are touched (as all templates use).
 */
export function instrumentHtml(
  html: string,
  opts: {
    pixelUrl: string;
    isOwnUrl: (url: string) => boolean;
    trackedUrl: (destination: string, linkName: string) => string;
  },
): string {
  let index = 0;
  const rewritten = html.replace(/href="(https?:\/\/[^"]*)"/gi, (match, raw: string) => {
    const destination = raw.replace(/&amp;/g, "&");
    if (!opts.isOwnUrl(destination)) return match;
    const name = linkName(destination, index);
    index += 1;
    return `href="${opts.trackedUrl(destination, name)}"`;
  });

  const pixel = `<img src="${opts.pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;
  // Matched on the original string: lowercasing can change its length ("İ" → "i̇").
  let at = -1;
  for (const m of rewritten.matchAll(/<\/body>/gi)) at = m.index;
  if (at === -1) return rewritten + pixel;
  return rewritten.slice(0, at) + pixel + rewritten.slice(at);
}
