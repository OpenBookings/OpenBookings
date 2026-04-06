import type { NextConfig } from "next";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn-cookieyes.com https://*.openbookings.co https://eu-assets.i.posthog.com https://internal-j.posthog.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.openbookings.co;
  img-src 'self' data: blob: https://images.openbookings.co https://cdn.openbookings.co https://cdn-cookieyes.com https://*.google.com https://*.googleusercontent.com https://*.openbookings.co;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://cdn-cookieyes.com https://*.cookieyes.com https://*.algolia.net https://*.i.posthog.com https://*.openbookings.co https://internal-j.posthog.com https://*.posthog.com;
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
  output: "standalone",

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

export default nextConfig;
