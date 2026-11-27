import { serializeJsonLd } from "@/lib/seo/structured-data";

/**
 * Structured data for search engines. Rendered on the server into the HTML;
 * a data block is not executed, so the CSP's script-src does not apply.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // serializeJsonLd escapes "<", so host-written text cannot close the tag.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
