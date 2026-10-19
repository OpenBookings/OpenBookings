/**
 * The markdown subset support replies may use: paragraphs, bullet and
 * numbered lists, **bold**, `inline code`, [links](https://…) and bare URLs.
 * Parsed into tokens that the chat renders as React elements, never as HTML,
 * so a reply can't inject markup. Links are limited to http(s) and
 * same-site paths.
 */

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineToken[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; internal: boolean; children: InlineToken[] };

export type Block =
  | { type: "paragraph"; children: InlineToken[] }
  | { type: "list"; ordered: boolean; items: InlineToken[][] };

/**
 * A safe href, and whether it stays inside the app: a `/path`, or an absolute
 * URL on `appOrigin`. Anything else (javascript:, data:, protocol-relative)
 * is null.
 */
export function resolveHref(raw: string, appOrigin?: string): { href: string; internal: boolean } | null {
  const href = raw.trim();
  if (href.startsWith("/") && !href.startsWith("//")) return { href, internal: true };
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (appOrigin && url.origin === appOrigin) {
      return { href: `${url.pathname}${url.search}${url.hash}`, internal: true };
    }
    return { href: url.toString(), internal: false };
  } catch {
    return null;
  }
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function parseInline(text: string, appOrigin?: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: "text", text: text.slice(last, index) });
    const [whole, bold, code, linkText, linkHref, bare] = match;
    if (bold !== undefined) {
      tokens.push({ type: "bold", children: parseInline(bold, appOrigin) });
    } else if (code !== undefined) {
      tokens.push({ type: "code", text: code });
    } else if (linkText !== undefined && linkHref !== undefined) {
      const resolved = resolveHref(linkHref, appOrigin);
      tokens.push(
        resolved
          ? { type: "link", ...resolved, children: parseInline(linkText, appOrigin) }
          : { type: "text", text: whole },
      );
    } else if (bare !== undefined) {
      const resolved = resolveHref(bare, appOrigin);
      tokens.push(
        resolved ? { type: "link", ...resolved, children: [{ type: "text", text: bare }] } : { type: "text", text: bare },
      );
    }
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(text: string, appOrigin?: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n"), appOrigin) });
      paragraph = [];
    }
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const ordered = Boolean(numbered);
      const last = blocks.at(-1);
      const children = parseInline(item[1] ?? "", appOrigin);
      if (last?.type === "list" && last.ordered === ordered) last.items.push(children);
      else blocks.push({ type: "list", ordered, items: [children] });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
