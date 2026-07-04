import { createAuth } from "@openbookings/auth/server";
import { sendMagicLink } from "@/lib/mailing/magic-link";
import { cache } from "react";
import { headers } from "next/headers";

export const auth = createAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://business.openbookings.co",
  secret: process.env.BETTER_AUTH_SECRET!,
  databaseUrl: process.env.DATABASE_URL!,
  sendMagicLink,
  trustedOrigins: [
    "https://appleid.apple.com",
    "https://business.openbookings.co",
    "https://openbookings.co",
    "http://localhost:3000",
    "http://localhost:8080",
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
 */
export const getServerSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
