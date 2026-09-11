import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

// `eval` is only needed by the dev-time React Refresh runtime, and the
// localhost origin only by the local guest app, so neither ships to
// production.
const isDev = process.env.NODE_ENV !== "production";
const DEV_SCRIPT_SRC = isDev ? " 'unsafe-eval' http://localhost:3000" : "";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://*.openbookings.co https://eu-assets.i.posthog.com https://*.posthog.com https://connect-js.stripe.com https://js.stripe.com${DEV_SCRIPT_SRC};
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://eu-assets.i.posthog.com;
  img-src 'self' data: blob: https://*.openbookings.co https://*.google.com https://*.googleusercontent.com https://*.maptiler.com https://*.stripe.com https://api.dicebear.com https://storage.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  media-src 'self';
  connect-src 'self' https://*.i.posthog.com https://*.openbookings.co https://*.posthog.com https://api.maptiler.com https://basemaps.cartocdn.com https://connect-js.stripe.com https://storage.googleapis.com wss://ob-durableobjects.w-vanderwal.workers.dev;
  worker-src 'self' blob:;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests; block-all-mixed-content;
  frame-src 'self' https://connect-js.stripe.com https://js.stripe.com;
`.replace(/\s{2,}/g, " ").trim();

const nextConfig: NextConfig = {
  transpilePackages: ["@openbookings/analytics", "@openbookings/messaging"],
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
          // Two years, applied to every openbookings.co subdomain. Add
          // `; preload` and submit at hstspreload.org once that is a
          // commitment we want to make — it is hard to walk back.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: ContentSecurityPolicy },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "openbookings",
  project: "openbookings-business",
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,

  widenClientFileUpload: true,

  tunnelRoute: "/monitoring",

  webpack: {
    automaticVercelMonitors: true,
  },

  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
});
