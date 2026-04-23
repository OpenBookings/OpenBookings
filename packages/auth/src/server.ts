import { betterAuth } from "better-auth";
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
};

export function createAuth(config: AuthServerConfig) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: new Pool({ connectionString: config.databaseUrl }),
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
    },
    trustedOrigins: config.trustedOrigins ?? [],
  });
}
