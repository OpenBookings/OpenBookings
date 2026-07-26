import { auth } from "@/lib/auth";
import { createMessagingRoutes } from "@openbookings/messaging";

/** Shared messaging route handlers, bound to this app's Better Auth instance. */
export const messagingRoutes = createMessagingRoutes({
  getSession: (headers) => auth.api.getSession({ headers }),
});
