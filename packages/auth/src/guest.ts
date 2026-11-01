import { betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { endpointFailed, refuseStalePasskeyRegistration } from "./guest-hooks";
import { passkeyAccountName } from "./passkey-account-name";
import {
  accountLinkingOptions,
  accountTypeHooksForPool,
  advancedConfig,
  createAuthPool,
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
  /**
   * Account emails. Optional so tests and tooling can build the instance
   * without a mail transport; without them, changing email and deleting the
   * account fail loudly instead of skipping the confirmation.
   */
  /** To the CURRENT address: confirm moving to `newEmail`. */
  sendChangeEmailConfirmation?: (input: { email: string; newEmail: string; url: string }) => Promise<void>;
  /** To an address that must prove it is reachable (the new one, during a change). */
  sendVerificationEmail?: (input: { email: string; url: string }) => Promise<void>;
  /** The deletion only happens when this link is opened. */
  sendDeleteAccountVerification?: (input: { email: string; url: string }) => Promise<void>;
  /** Runs before the user row is deleted; throw an APIError to refuse. */
  beforeDeleteUser?: (userId: string) => Promise<void>;
  /** After a passkey is stored; failures are logged, never block. */
  onPasskeyAdded?: (input: { email: string; name: string | null }) => Promise<void>;
};

function notConfigured(what: string): never {
  throw new Error(`[auth] ${what} is not configured on the guest instance`);
}

/**
 * Auth instance for apps/web (guest portal). Deliberately mounts no
 * organization or admin endpoints: hitting one on the guest app's
 * /api/auth/* returns 404. Guests sign in with magic link, Google, Apple or
 * a passkey, and are created with account_type 'private'.
 *
 * Guests have no password and no step-up clock. Changing the sign-in email
 * is confirmed from the current inbox and then verified from the new one;
 * deleting the account is confirmed by an emailed link. Adding a passkey
 * needs a sign-in from the last 24 hours (guest-hooks.ts).
 */
export function createGuestAuth(config: GuestAuthConfig) {
  const pool = createAuthPool(config.databaseUrl);
  const secureCookies = config.baseURL.startsWith("https://");

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: {
      additionalFields: userAdditionalFields,
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          if (!config.sendChangeEmailConfirmation) notConfigured("sendChangeEmailConfirmation");
          await config.sendChangeEmailConfirmation({ email: user.email, newEmail, url });
        },
      },
      deleteUser: {
        enabled: true,
        // Always set: without it Better Auth deletes on the spot.
        sendDeleteAccountVerification: async ({ user, url }) => {
          if (!config.sendDeleteAccountVerification) notConfigured("sendDeleteAccountVerification");
          await config.sendDeleteAccountVerification({ email: user.email, url });
        },
        deleteTokenExpiresIn: 60 * 60,
        beforeDelete: async (user) => {
          await config.beforeDeleteUser?.(user.id);
        },
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        if (!config.sendVerificationEmail) notConfigured("sendVerificationEmail");
        await config.sendVerificationEmail({ email: user.email, url });
      },
      expiresIn: 60 * 60,
    },
    session: sharedSessionOptions,
    account: accountLinkingOptions,
    advanced: advancedConfig(config.cookiePrefix, secureCookies),
    databaseHooks: accountTypeHooksForPool(pool, "private"),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await refuseStalePasskeyRegistration(ctx);
        // The browser offers the passkey under the guest's email.
        return passkeyAccountName(ctx);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/passkey/verify-registration" || endpointFailed(ctx.context.returned)) return;
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx).catch(() => null));
        const user = session?.user;
        if (!user?.email || !config.onPasskeyAdded) return;
        const name = (ctx.body as { name?: unknown } | undefined)?.name;
        await config
          .onPasskeyAdded({ email: user.email, name: typeof name === "string" && name ? name : null })
          .catch((err) => console.error("[auth] passkey-added email failed:", err));
      }),
    },
    plugins: [
      magicLink(magicLinkOptions(config)),
      passkey({
        rpID: new URL(config.baseURL).hostname,
        rpName: "OpenBookings",
        origin: config.baseURL,
      }),
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
