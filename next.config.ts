import type { NextConfig } from "next";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn-cookieyes.com https://apis.google.com https://accounts.google.com https://*.openbookings.co;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https://images.openbookings.co https://cdn.openbookings.co https://cdn-cookieyes.com https://accounts.google.com https://*.google.com https://*.googleusercontent.com https://*.openbookings.co;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://cdn-cookieyes.com https://*.cookieyes.com https://apis.google.com https://accounts.google.com https://*.algolia.net https://eu.i.posthog.com https://*.openbookings.co;
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

  // jwks-rsa (transitive dep of firebase-admin) requires jose@^4, but the
  // project root has jose@^6, so Bun installs a nested jose@4 inside
  // node_modules/jwks-rsa/node_modules/jose. @vercel/nft (used by Next.js
  // standalone) can't statically trace dynamic require('jose') calls, so we
  // must explicitly include it in the output trace.
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/jwks-rsa/node_modules/jose/**/*"],
  },

  allowedDevOrigins: ["127.0.0.1"],

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