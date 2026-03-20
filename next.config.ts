import type { NextConfig } from "next";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn-cookieyes.com https://apis.google.com https://accounts.google.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https://images.openbookings.co https://cdn.openbookings.co https://cdn-cookieyes.com https://accounts.google.com https://*.google.com https://*.googleusercontent.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://cdn-cookieyes.com https://apis.google.com https://accounts.google.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https:;
  worker-src 'self' blob:;
  frame-src 'self' https://cdn-cookieyes.com https://accounts.google.com https://*.firebaseapp.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  block-all-mixed-content;
`.replace(/\s{2,}/g, " ").trim();

const nextConfig: NextConfig = {
  output: "standalone",

  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const useAuthProxy = process.env.NEXT_PUBLIC_FIREBASE_AUTH_PROXY === "true";

    const firebaseRewrites =
      projectId && useAuthProxy
        ? [
            {
              source: "/__/auth/:path*",
              destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
            },
          ]
        : [];

    return [
      ...firebaseRewrites,
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
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
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