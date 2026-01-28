import type { NextConfig } from "next";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn-cookieyes.com https://apis.google.com https://accounts.google.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://images.openbookings.co https://cdn-cookieyes.com https://accounts.google.com https://*.google.com https://*.googleusercontent.com;
  font-src 'self';
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://cdn-cookieyes.com https://apis.google.com https://accounts.google.com https:;
  worker-src 'self' blob:;
  frame-src 'self' https://cdn-cookieyes.com https://accounts.google.com https://*.firebaseapp.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  block-all-mixed-content;
`.replace(/\s{2,}/g, " ").trim();

// ... existing code ...

const nextConfig: NextConfig = {
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const useAuthProxy = process.env.NEXT_PUBLIC_FIREBASE_AUTH_PROXY === "true";
    if (!projectId || !useAuthProxy) return [];
    // When using custom domain for auth: proxy /__/auth/* to Firebase so the handler is served.
    // If instead you use authDomain = PROJECT_ID.firebaseapp.com, set redirect URI to that in
    // Google/Apple consoles and do NOT set NEXT_PUBLIC_FIREBASE_AUTH_PROXY.
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
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
