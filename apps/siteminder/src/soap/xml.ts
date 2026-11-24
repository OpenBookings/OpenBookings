import { XMLParser } from "fast-xml-parser";

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Decodes the five predefined entities and numeric references in one pass, so `&amp;lt;` becomes `&lt;`, not `<`.
 * Anything else (including `&name;`) stays literal; custom entities cannot exist because DOCTYPE/ENTITY are refused first.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g, (match, hex, dec, name) => {
    if (name) return PREDEFINED[name] as string;
    const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    const valid =
      code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
    return valid ? String.fromCodePoint(code) : match;
  });
}

/**
 * Entity processing stays off (nothing is ever expanded by the parser); values are decoded by `decodeEntities` instead.
 * Credentials are kept untrimmed so they compare exactly; every other text value is trimmed.
 */
export const xmlParser = new XMLParser({
  processEntities: false,
  ignoreAttributes: false,
  allowBooleanAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  tagValueProcessor: (tagName, value) => decodeEntities(tagName === "Username" || tagName === "Password" ? value : value.trim()),
  attributeValueProcessor: (_name, value) => decodeEntities(value),
});

// XML 1.0 forbids most control characters even when escaped.
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function xmlEscape(s: string): string {
  return s
    .replace(ILLEGAL_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Minified XML from a plain object: `@_name` keys are attributes, `#text` is text,
 * arrays repeat the element, other keys are child elements. Empty elements self-close.
 */
export function toXml(name: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => toXml(name, v)).join("");
  if (value === null || value === undefined) return `<${name}/>`;
  if (typeof value !== "object") {
    const text = xmlEscape(String(value));
    return text === "" ? `<${name}/>` : `<${name}>${text}</${name}>`;
  }
  let attrs = "";
  let children = "";
  let text = "";
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith("@_")) attrs += ` ${key.slice(2)}="${xmlEscape(String(v))}"`;
    else if (key === "#text") text = xmlEscape(String(v));
    else children += toXml(key, v);
  }
  const inner = text + children;
  return inner === "" ? `<${name}${attrs}/>` : `<${name}${attrs}>${inner}</${name}>`;
}
