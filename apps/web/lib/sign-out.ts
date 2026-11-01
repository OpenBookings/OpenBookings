"use client";

import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";

/**
 * Sign out from anywhere in the guest app: the analytics identity goes first,
 * so the next person on a shared browser does not inherit it.
 */
export async function signOutGuest(router: { replace: (href: string) => void }) {
  posthog.capture("sign_out");
  posthog.reset();
  await authClient.signOut();
  router.replace("/");
}
