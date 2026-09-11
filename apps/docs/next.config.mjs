import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withMDX = createMDX();

// `eval` is only needed by the dev-time React Refresh runtime; a production
// bundle never evaluates strings, so the allowance never ships.
const isDev = process.env.NODE_ENV !== 'production';
const DEV_SCRIPT_SRC = isDev ? " 'unsafe-eval'" : '';

// The docs are static content with no third-party scripts of their own, so
// everything stays same-origin apart from Google Fonts. `frame-ancestors`,
// `base-uri` and `form-action` are spelled out because they do not fall back
// to `default-src`.
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${DEV_SCRIPT_SRC};
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https://*.openbookings.co;
  font-src 'self' data: https://fonts.gstatic.com;
  connect-src 'self';
  media-src 'self';
  worker-src 'self' blob:;
  frame-src 'none';
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  block-all-mixed-content;
`
  .replace(/\s{2,}/g, ' ')
  .trim();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Two years, applied to every openbookings.co subdomain. Add
          // `; preload` and submit at hstspreload.org once that is a
          // commitment we want to make — it is hard to walk back.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
        ],
      },
    ];
  },
};

export default withMDX(config);
