import { createGuestAuth } from "@openbookings/auth/guest";
import { sessionForApp } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { sendMagicLink } from "@/lib/mailing/magic-link";
import { cache } from "react";
import { headers } from "next/headers";

const env = readAuthEnv();

export const auth = createGuestAuth({
  baseURL: env.AUTH_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  databaseUrl: process.env.DATABASE_URL!,
  sendMagicLink,
  cookiePrefix: env.AUTH_COOKIE_PREFIX,
  trustedOrigins: [
    "https://appleid.apple.com",
    "https://openbookings.co",
    "http://app.localhost:3002",
  ],
  dashApiKey: process.env.BETTER_AUTH_DASH_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  appleClientId: process.env.APPLE_CLIENT_ID,
  appleClientSecret: process.env.APPLE_CLIENT_SECRET,
});

/**
 * Single source of truth for the current request's session on the server,
 * request-scoped via React cache. Every read goes through sessionForApp so a
 * host-app cookie (or a session row stamped with the wrong portal) resolves
 * to null on every route, not just at sign-in.
 */
export const getServerSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return sessionForApp(session, "private");
});
