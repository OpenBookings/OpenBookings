import type { MetadataRoute } from "next";
import { getPool } from "@openbookings/db";
import { getCurrentVersion, LEGAL_DOCUMENTS, LEGAL_LOCALES } from "@/lib/legal/documents";
import { absoluteUrl, propertyPath } from "@/lib/seo/site";

// Read on every request: the build has no database, and a listing a host
// publishes should be in here the next time a crawler asks, not an hour on.
// The query is one indexed scan, and crawlers fetch this rarely.
export const dynamic = "force-dynamic";

/**
 * Only pages that may appear in search: the homepage, every live listing, the
 * reviewed legal texts and the review rules. Search, account, checkout and
 * booking pages are `noindex` and stay out.
 *
 * Demo hotels are left out even in testing mode, which must never be indexed
 * anyway. If the query fails this answers 500 rather than a sitemap without
 * listings, so a crawler retries instead of reading the listings as gone.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A listing changes when the property, its content or its photos do.
  const { rows } = await getPool().query<{ slug: string; last_modified: Date }>(
    `SELECT p.slug,
            GREATEST(
              p.updated_at,
              c.updated_at,
              (SELECT MAX(pi.created_at) FROM property_images pi WHERE pi.property_id = p.id)
            ) AS last_modified
       FROM properties p
       LEFT JOIN property_content c ON c.property_id = p.id
      WHERE p.is_active AND NOT p.is_demo
      ORDER BY p.slug`,
  );

  const properties: MetadataRoute.Sitemap = rows.map((row) => ({
    url: absoluteUrl(propertyPath(row.slug)),
    lastModified: row.last_modified,
  }));

  const legal: MetadataRoute.Sitemap = LEGAL_DOCUMENTS.flatMap((doc) => {
    const version = getCurrentVersion(doc);
    const reviewed = LEGAL_LOCALES.filter((locale) => version.locales[locale]?.status === "translated");
    const languages = Object.fromEntries(
      reviewed.map((locale) => [locale, absoluteUrl(`/legal/${locale}/${doc.slug}`)]),
    );
    return reviewed.map((locale) => ({
      url: absoluteUrl(`/legal/${locale}/${doc.slug}`),
      lastModified: version.lastUpdated,
      alternates: { languages },
    }));
  });

  // One English page, not a versioned legal text (see app/legal/review-rules).
  const reviewRules: MetadataRoute.Sitemap = [{ url: absoluteUrl("/legal/review-rules") }];

  return [{ url: absoluteUrl("/") }, ...properties, ...legal, ...reviewRules];
}
