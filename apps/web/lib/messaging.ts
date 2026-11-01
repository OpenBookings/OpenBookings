import { auth } from "@/lib/auth";
import { sessionForApp } from "@openbookings/auth/server";
import { createMessagingRoutes } from "@openbookings/messaging";

/**
 * Shared messaging route handlers, bound to the guest Better Auth instance.
 * sessionForApp re-checks account_type/portal on every call, so a host-app
 * cookie never resolves to a guest session here. Everything after the session
 * (participant checks, SQL, realtime) is the same code the host app runs.
 */
export const messagingRoutes = createMessagingRoutes({
  getSession: async (headers) => sessionForApp(await auth.api.getSession({ headers }), "private"),
});
