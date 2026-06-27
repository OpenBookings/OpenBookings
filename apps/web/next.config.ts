import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn-cookieyes.com https://*.openbookings.co https://eu-assets.i.posthog.com https://internal-j.posthog.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.openbookings.co;
  img-src 'self' data: blob: https://images.openbookings.co https://cdn.openbookings.co https://cdn-cookieyes.com https://*.google.com https://*.googleusercontent.com https://*.openbookings.co;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://cdn-cookieyes.com https://*.cookieyes.com https://*.algolia.net https://*.i.posthog.com https://*.openbookings.co https://internal-j.posthog.com https://*.posthog.com https://*.maptiler.com;
  worker-src 'self' blob:;
  frame-src 'self' https://cdn-cookieyes.com https://*.posthog.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  block-all-mixed-content;
`.replace(/\s{2,}/g, " ").trim();

const nextConfig: NextConfig = {
  transpilePackages: ["@openbookings/analytics"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),

  allowedDevOrigins: ["127.0.0.1"],

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },

  skipTrailingSlashRedirect: true,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=86400" },
          {
            key: "Content-Security-Policy",
            value: ContentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "openbookings",
  project: "openbookings-guests",
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  tunnelRoute: "/monitoring",

  webpack: {
    automaticVercelMonitors: true,
  },

  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
});
