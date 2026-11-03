import { createGuestAuth } from "@openbookings/auth/guest";
import { sessionForApp } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { query } from "@openbookings/db";
import { sendMagicLink } from "@/lib/mailing/magic-link";
import {
  deleteAccountConfirmation,
  emailChangeConfirmation,
  newEmailVerification,
  passkeyAdded,
  sendAccountMail,
} from "@/lib/mailing/account-mail";
import { anonymizeGuestData, assertCanDeleteAccount, todayInEurope } from "@/lib/account/deletion";
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
    // Local portal origin: development only.
    ...(process.env.NODE_ENV === "production" ? [] : ["http://web.localhost:3002"]),
  ],
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  appleClientId: process.env.APPLE_CLIENT_ID,
  appleClientSecret: process.env.APPLE_CLIENT_SECRET,
  sendChangeEmailConfirmation: ({ email, newEmail, url }) =>
    sendAccountMail(email, emailChangeConfirmation(newEmail, url)),
  sendVerificationEmail: ({ email, url }) => sendAccountMail(email, newEmailVerification(url)),
  sendDeleteAccountVerification: ({ email, url }) => sendAccountMail(email, deleteAccountConfirmation(url)),
  beforeDeleteUser: async (userId) => {
    // Checked again here, at the moment the emailed link is opened: a stay
    // booked after the request must still block it.
    await assertCanDeleteAccount(userId, query, todayInEurope());
    await anonymizeGuestData(userId, query);
  },
  onPasskeyAdded: ({ email, name }) =>
    sendAccountMail(email, passkeyAdded(name ?? "A new passkey", `${env.AUTH_BASE_URL}/account/security`)),
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
