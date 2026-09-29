import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Only report from deployed environments. Locally the tunnelled envelopes just
  // add noise to the dev server log (and stall outright without working IPv6).
  enabled: process.env.NODE_ENV === "production",
  // Set from the build arg of the same name, so an event can be traced back to
  // the exact image serving it. Undefined in local dev, where Sentry is off anyway.
  release: process.env.NEXT_PUBLIC_RELEASE_SHA,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1,
  debug: false,
});
