import type { MetadataRoute } from "next";
import { isTestingMode } from "@openbookings/demo";
import { absoluteUrl } from "@/lib/seo/site";

// Testing mode is a runtime setting of the container, not of the build.
export const dynamic = "force-dynamic";

/**
 * Cloudflare puts its managed block in front of this file: the AI policy
 * (search allowed, training crawlers such as GPTBot and ClaudeBot disallowed)
 * is set there, in the dashboard, so it is not repeated here.
 *
 * Pages that must stay out of search carry `noindex` instead of a Disallow
 * line: a crawler that may not fetch a page never sees its noindex, and can
 * still list the bare URL from links. Disallowed here are only paths that
 * are not pages at all.
 */
export default function robots(): MetadataRoute.Robots {
  // A testing deployment shows demo hotels and must not be indexed at all.
  if (isTestingMode()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // API routes, email open/click redirects, the Sentry tunnel.
      disallow: ["/api/", "/e/", "/monitoring"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
