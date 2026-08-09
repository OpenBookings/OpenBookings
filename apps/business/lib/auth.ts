import { createAuth, sessionForApp } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { sendMagicLink } from "@/lib/mailing/magic-link";
import { cache } from "react";
import { headers } from "next/headers";

const env = readAuthEnv();

export const auth = createAuth({
  baseURL: env.AUTH_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  databaseUrl: process.env.DATABASE_URL!,
  sendMagicLink,
  cookiePrefix: env.AUTH_COOKIE_PREFIX,
  trustedOrigins: [
    "https://appleid.apple.com",
    "https://business.openbookings.co",
    "https://openbookings.co",
    "http://business.localhost:3001",
  ],
  dashApiKey: process.env.BETTER_AUTH_DASH_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID_BUSINESS,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET_BUSINESS,
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  accountType: "business",
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
