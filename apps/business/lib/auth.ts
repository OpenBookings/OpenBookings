import { createHostAuth } from "@openbookings/auth/host";
import { sessionForApp } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { sendMagicLink } from "@/lib/mailing/magic-link";
import { sendSecurityAlert } from "@/lib/mailing/security-alert";
import { sendInvitationEmail } from "@/lib/mailing/invitation";
import { forwardAuthEvent } from "@/lib/tirreno";
import { hostTrustedOrigins } from "@/lib/trusted-origins";
import { setOrgGuard } from "@openbookings/authz";
import { DEMO_ORG_ID, isTestingMode } from "@openbookings/demo";
import { cache } from "react";
import { headers } from "next/headers";

const env = readAuthEnv();

// Leftover demo rows must not act outside testing mode.
setOrgGuard((orgId) => orgId !== DEMO_ORG_ID || isTestingMode());

export const auth = createHostAuth({
  baseURL: env.AUTH_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  databaseUrl: process.env.DATABASE_URL!,
  sendMagicLink,
  sendSecurityAlert,
  sendInvitationEmail,
  onAuthEvent: forwardAuthEvent,
  cookiePrefix: env.AUTH_COOKIE_PREFIX,
  trustedOrigins: hostTrustedOrigins(process.env.NODE_ENV),
  googleClientId: process.env.GOOGLE_CLIENT_ID_BUSINESS,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET_BUSINESS,
});

/**
 * Single source of truth for the current request's session on the server.
 * Wrapped in React's request-scoped cache so every server component/action
 * in the same render sees the exact same session, instead of each call site
 * hitting better-auth's cookie cache/DB independently and risking a
 * momentary disagreement between them.
 *
 * Every read goes through sessionForApp: an already-issued cookie from the
 * guest app (or a session row stamped with the wrong portal) resolves to
 * null here, on every route — the sign-in-time hook alone can't catch a
 * cookie that was issued before it or injected across apps.
 */
export const getServerSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return sessionForApp(session, "business");
});
