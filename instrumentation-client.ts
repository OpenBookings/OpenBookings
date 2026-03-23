import posthog from "posthog-js";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_KEY!;

if (posthogToken) {
  posthog.init(posthogToken, {
    api_host: "https://a.openbookings.co",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    defaults: "2026-01-30",
    capture_pageview: false,
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
} else if (process.env.NODE_ENV === "development") {
  console.warn(
    "[PostHog] Missing NEXT_PUBLIC_POSTHOG_KEY; skipping posthog.init()"
  );
}
