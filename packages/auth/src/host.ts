import { betterAuth, APIError } from "better-auth";
import { magicLink, organization, admin } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";
import { ac, roles } from "@openbookings/authz/permissions";
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
 * plugin (with the shared access-control statement from packages/authz) and
 * the admin plugin (staff endpoints; every admin-plugin user field is
 * input:false, so `role` cannot be set at signup — verified against 1.6.25
 * schema source). Hosts sign in with magic link, Google, or Microsoft, and
 * are created with account_type 'business'.
 */
export function createHostAuth(config: HostAuthConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const secureCookies = config.baseURL.startsWith("https://");

  /**
   * A role change or removal must take effect now, not when the cookie
   * cache expires: delete the member's sessions so the next request
   * re-authenticates. Better Auth's hooks don't expose the internal
   * adapter here, so this goes straight at the session table.
   */
  const revokeUserSessions = async (userId: string) => {
    await pool.query(`DELETE FROM "session" WHERE "userId" = $1`, [userId]);
  };

  /**
   * Last-owner guard: Stripe Connect and the signed Host Agreement are
   * bound to the owner identity, so the final owner can never be removed
   * or demoted.
   */
  const assertNotLastOwner = async (organizationId: string, memberId: string) => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM "member" WHERE "organizationId" = $1 AND role = 'owner'`,
      [organizationId],
    );
    const owners = result.rows.map((row) => row.id);
    if (owners.length === 1 && owners[0] === memberId) {
      throw new APIError("BAD_REQUEST", {
        message:
          "This member is the organization's last owner. Transfer ownership before removing or demoting them.",
      });
    }
  };

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: { additionalFields: userAdditionalFields },
    session: {
      ...sharedSessionOptions,
      // Shorter than the guest app's 5 minutes: a demoted admin retains the
      // permissions baked into the signed cookie until it expires, so the
      // host portal caps that exposure at 60s (plus explicit revocation in
      // the member hooks below).
      cookieCache: {
        enabled: true,
        maxAge: 60,
      },
    },
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
      organization({
        ac,
        roles,
        creatorRole: "owner",
        organizationHooks: {
          beforeRemoveMember: async ({ member, organization: org }) => {
            if (member.role === "owner") {
              await assertNotLastOwner(org.id, member.id);
            }
          },
          afterRemoveMember: async ({ user }) => {
            await revokeUserSessions(user.id);
          },
          beforeUpdateMemberRole: async ({ member, newRole, organization: org }) => {
            if (member.role === "owner" && newRole !== "owner") {
              await assertNotLastOwner(org.id, member.id);
            }
          },
          afterUpdateMemberRole: async ({ user }) => {
            await revokeUserSessions(user.id);
          },
        },
      }),
      admin({
        // Platform staff role, unrelated to org member roles. Nobody gets it
        // via any request input (input:false on the field); it is only ever
        // granted by an existing admin or directly in the database.
        adminRoles: ["admin"],
        // Impersonation sessions die after 30 minutes no matter what.
        impersonationSessionDuration: 30 * 60,
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

/**
 * Impersonation wrapper (task 13): never call auth.api.impersonateUser
 * directly. Requires a typed reason and writes the audit_log row with the
 * acting staff id, target, reason, IP, and UA before the impersonated
 * session is created. The session lifetime cap comes from
 * impersonationSessionDuration above.
 */
export async function impersonateWithAudit(
  auth: ReturnType<typeof createHostAuth>,
  input: {
    targetUserId: string;
    reason: string;
    actorStaffUserId: string;
    ip: string | null;
    userAgent: string | null;
    headers: Headers;
    /** Audit sink — packages/db query; injected to keep this testable. */
    writeAudit: (event: {
      action: "impersonation.start";
      actor_user_id: string;
      target_user_id: string;
      reason: string;
      ip: string | null;
      user_agent: string | null;
    }) => Promise<void>;
  },
) {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new Error(
      "Impersonation requires a reason of at least 10 characters (ticket ref + why).",
    );
  }
  await input.writeAudit({
    action: "impersonation.start",
    actor_user_id: input.actorStaffUserId,
    target_user_id: input.targetUserId,
    reason,
    ip: input.ip,
    user_agent: input.userAgent,
  });
  return auth.api.impersonateUser({
    body: { userId: input.targetUserId },
    headers: input.headers,
  });
}
