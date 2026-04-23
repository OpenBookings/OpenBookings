import { PostHog } from "posthog-node";

export function getPostHogClient(): PostHog {
  const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_KEY!;

  return new PostHog(posthogToken, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    flushAt: 1,
    flushInterval: 0,
  });
}
