"use client";

import { useAnalyticsIdentity } from "@openbookings/analytics/client";

import { authClient } from "@/lib/auth-client";

/**
 * Tells PostHog which account the events belong to. Renders nothing.
 *
 * Mounted in the root layout rather than at a sign-in handler: magic-link and
 * social sign-in both come back through a redirect, so there is no client-side
 * "sign-in succeeded" moment to hang this off. What both paths do have is a
 * session that exists on the next paint, which is exactly what this watches.
 */
export function AnalyticsIdentity() {
  const { data: session } = authClient.useSession();
  useAnalyticsIdentity(session?.user?.id ?? null);
  return null;
}
