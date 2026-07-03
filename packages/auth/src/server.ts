import { betterAuth, APIError, type User, type Session } from "better-auth";
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

/**
 * True when a user with `actual` account_type may sign in on an app that
 * requires `required`. NULL/missing account_type is rejected — the DB
 * enforces NOT NULL, so a missing value means the row predates enforcement
 * and needs manual review, not silent access.
 */
export function isAccountTypeAllowed(
  required: string,
  actual: string | null | undefined,
): boolean {
  return actual === required;
}

/** Message shown when an account tries to sign in on the wrong app. */
export function accountTypeMismatchMessage(required: string): string {
  return required === "business"
    ? "This account is not a business account. Please sign in at openbookings.co instead."
    : "This is a business account. Please sign in at business.openbookings.co instead.";
}

/**
 * Builds the databaseHooks that enforce account_type separation. Better Auth
 * runs `session.create.before` for every sign-in method — password, magic
 * link, and OAuth callbacks — so this is the single enforcement point.
 * Exported (with an injectable lookup) so tests exercise the exact hooks the
 * apps run.
 */
export function buildAccountTypeHooks(
  accountType: string,
  getAccountType: (userId: string) => Promise<string | null | undefined>,
) {
  return {
    user: {
      create: {
        before: async (user: User & Record<string, unknown>) => ({
          data: { ...user, account_type: accountType },
        }),
      },
    },
    session: {
      create: {
        before: async (session: Session & Record<string, unknown>) => {
          const actual = await getAccountType(session.userId);
          if (!isAccountTypeAllowed(accountType, actual)) {
            throw new APIError("FORBIDDEN", {
              message: accountTypeMismatchMessage(accountType),
            });
          }
        },
      },
    },
  };
}

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
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    databaseHooks: config.accountType
      ? buildAccountTypeHooks(config.accountType, async (userId) => {
          const result = await pool.query<{ account_type: string | null }>(
            `SELECT account_type FROM "user" WHERE id = $1`,
            [userId],
          );
          return result.rows[0]?.account_type;
        })
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