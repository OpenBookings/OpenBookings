import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";
import {
  accountTypeHooksForPool,
  advancedCookieConfig,
  magicLinkOptions,
  sharedSessionOptions,
  userAdditionalFields,
  type BaseAuthConfig,
} from "./shared";

export type GuestAuthConfig = BaseAuthConfig & {
  googleClientId?: string;
  googleClientSecret?: string;
  appleClientId?: string;
  appleClientSecret?: string;
};

/**
 * Auth instance for apps/web (guest portal). Deliberately mounts no
 * organization or admin endpoints: hitting one on the guest app's
 * /api/auth/* returns 404. Guests sign in with magic link, Google, or
 * Apple, and are created with account_type 'private'.
 */
export function createGuestAuth(config: GuestAuthConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const secureCookies = config.baseURL.startsWith("https://");

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: { additionalFields: userAdditionalFields },
    session: sharedSessionOptions,
    advanced: advancedCookieConfig(config.cookiePrefix, secureCookies),
    databaseHooks: accountTypeHooksForPool(pool, "private"),
    plugins: [
      magicLink(magicLinkOptions(config)),
      ...(config.dashApiKey ? [dash({ apiKey: config.dashApiKey })] : []),
    ],
    socialProviders: {
      ...(config.googleClientId && config.googleClientSecret
        ? {
          google: {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
          },
        }
        : {}),
      ...(config.appleClientId && config.appleClientSecret
        ? {
          apple: {
            clientId: config.appleClientId,
            clientSecret: config.appleClientSecret,
          },
        }
        : {}),
    },
    trustedOrigins: config.trustedOrigins ?? [],
  });
}
