import { auth } from "@/lib/auth";
import { sessionForApp } from "@openbookings/auth/server";
import { createMessagingRoutes } from "@openbookings/messaging";

/**
 * Shared messaging route handlers, bound to this app's Better Auth instance.
 * sessionForApp re-checks account_type/portal on every call so a guest-app
 * cookie never resolves to a host session here.
 */
export const messagingRoutes = createMessagingRoutes({
  getSession: async (headers) =>
    sessionForApp(await auth.api.getSession({ headers }), "business"),
});
