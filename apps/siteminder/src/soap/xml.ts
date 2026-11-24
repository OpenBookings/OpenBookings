import { XMLParser } from "fast-xml-parser";

/** Entities are never expanded and DOCTYPEs are refused before parsing, so there is nothing to expand. */
export const xmlParser = new XMLParser({
  processEntities: false,
  ignoreAttributes: false,
  allowBooleanAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// XML 1.0 forbids most control characters even when escaped.
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

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
