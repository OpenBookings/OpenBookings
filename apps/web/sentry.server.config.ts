import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Only report from deployed environments. Locally the tunnelled envelopes just
  // add noise to the dev server log (and stall outright without working IPv6).
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 1,
  debug: false,
});
