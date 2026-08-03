import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

// Chatwoot loads its SDK, embeds the widget in an iframe and opens a websocket
// back to its own origin, so that origin has to be allowed in several
// directives. Unset (e.g. in CI/preview) means no widget and no CSP changes.
const chatwootUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
const chatwootOrigin = chatwootUrl ? new URL(chatwootUrl).origin : "";
const chatwootSocket = chatwootOrigin.replace(/^http/, "ws");

// http:// origins (local Chatwoot in dev) can't survive upgrade-insecure-requests
// or block-all-mixed-content, so drop both when that's what we're pointed at.
const isInsecureChatwoot = chatwootOrigin.startsWith("http://");

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.openbookings.co https://eu-assets.i.posthog.com https://*.posthog.com https://connect-js.stripe.com https://js.stripe.com http://localhost:3000;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://eu-assets.i.posthog.com;
  img-src 'self' data: blob: https://*.openbookings.co https://*.google.com https://*.googleusercontent.com https://*.maptiler.com https://*.stripe.com https://api.dicebear.com https://storage.googleapis.com ${chatwootOrigin};
  font-src 'self' https://fonts.gstatic.com ${chatwootOrigin};
  media-src 'self' ${chatwootOrigin};
  connect-src 'self' https://*.i.posthog.com https://*.openbookings.co https://*.posthog.com https://api.maptiler.com https://basemaps.cartocdn.com https://connect-js.stripe.com https://storage.googleapis.com wss://ob-durableobjects.w-vanderwal.workers.dev ${chatwootOrigin} ${chatwootSocket};
  worker-src blob:;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  ${isInsecureChatwoot ? "" : "upgrade-insecure-requests; block-all-mixed-content;"}
  frame-src 'self' https://connect-js.stripe.com https://js.stripe.com ${chatwootOrigin};
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
          { key: "Strict-Transport-Security", value: "max-age=86400" },
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
