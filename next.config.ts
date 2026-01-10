import type { NextConfig } from "next";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://consent.cookiebot.com https://consentcdn.cookiebot.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://storage.googleapis.com https://*.cookiebot.com;
  font-src 'self';
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://*.cookiebot.com https:;
  worker-src 'self' blob:;
  frame-src 'self' https://consent.cookiebot.com https://consentcdn.cookiebot.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  block-all-mixed-content;
`.replace(/\s{2,}/g, " ").trim();

// ... existing code ...

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=86400",
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
