import { betterAuth, APIError } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";

export type AuthServerConfig = {
  baseURL: string;
  secret: string;
  databaseUrl: string;
  sendMagicLink: (email: string, url: string) => Promise<void>;
  trustedOrigins?: string[];
  dashApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  appleClientId?: string;
  appleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  /**
   * When set, new users are created with this account_type, and sign-in is
   * blocked for users whose account_type is explicitly different.
   */
  accountType?: string;
};

export function createAuth(config: AuthServerConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: {
      additionalFields: {
        account_type: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: config.accountType
      ? {
          user: {
            create: {
              before: async (user) => ({
                data: { ...user, account_type: config.accountType },
              }),
            },
          },
          session: {
            create: {
              before: async (session) => {
                const result = await pool.query<{ account_type: string | null }>(
                  `SELECT account_type FROM "user" WHERE id = $1`,
                  [session.userId],
                );
                const user = result.rows[0];
                if (!user || user.account_type !== config.accountType) {
                  throw new APIError("FORBIDDEN", {
                    message: "This account is not authorized to sign in here.",
                  });
                }
              },
            },
          },
        }
      : undefined,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await config.sendMagicLink(email, url);
        },
        expiresIn: 60 * 15,
      }),
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
      ...(config.appleClientId && config.appleClientSecret
        ? {
          apple: {
            clientId: config.appleClientId,
            clientSecret: config.appleClientSecret,
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
          },
        } : {}),
    },
    trustedOrigins: config.trustedOrigins ?? [],
  });
}
