import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";
import {
  accountLinkingOptions,
  accountTypeHooksForPool,
  advancedCookieConfig,
  magicLinkOptions,
  microsoftEmailFromProfile,
  sharedSessionOptions,
  stampMicrosoftTenantId,
  userAdditionalFields,
  type BaseAuthConfig,
} from "./shared";

export type HostAuthConfig = BaseAuthConfig & {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
};

/**
 * Auth instance for apps/business (host portal). Mounts the organization
 * plugin; hosts sign in with magic link, Google, or Microsoft, and are
 * created with account_type 'business'. (Admin, passkey, and twoFactor land
 * with their own tasks — each adds endpoints and DB tables, so they are not
 * part of the factory split.)
 */
export function createHostAuth(config: HostAuthConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const secureCookies = config.baseURL.startsWith("https://");

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: { additionalFields: userAdditionalFields },
    session: sharedSessionOptions,
    account: {
      ...accountLinkingOptions,
      additionalFields: {
        // Entra tenant id from the Microsoft id token's `tid` claim,
        // stamped by the account.create.before hook. Used for org auto-join
        // later.
        tenant_id: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    advanced: advancedCookieConfig(config.cookiePrefix, secureCookies),
    databaseHooks: {
      ...accountTypeHooksForPool(pool, "business"),
      account: {
        create: {
          before: async (account) => stampMicrosoftTenantId(account),
        },
      },
    },
    plugins: [
      magicLink(magicLinkOptions(config)),
      ...(config.dashApiKey ? [dash({ apiKey: config.dashApiKey })] : []),
      organization(),
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
      ...(config.microsoftClientId && config.microsoftClientSecret
        ? {
          microsoft: {
            clientId: config.microsoftClientId,
            clientSecret: config.microsoftClientSecret,
            tenantId: 'common',
            authority: "https://login.microsoftonline.com",
            prompt: "select_account",
            // Minimal scopes: our multi-tenant Entra app requests only what
            // sign-in needs, so tenant admins reviewing consent see no Graph
            // access. disableProfilePhoto skips the Graph /me/photos call
            // that would otherwise need User.Read.
            disableDefaultScope: true,
            scope: ["openid", "profile", "email"],
            disableProfilePhoto: true,
            mapProfileToUser: (profile: {
              email?: string;
              preferred_username?: string;
              upn?: string;
            }) => ({
              email: microsoftEmailFromProfile(profile),
            }),
          },
        } : {}),
    },
    trustedOrigins: config.trustedOrigins ?? [],
  });
}
