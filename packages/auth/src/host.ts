import { betterAuth, APIError } from "better-auth";
import { magicLink, organization, admin, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { passkey } from "@better-auth/passkey";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";
import { ac, roles } from "@openbookings/authz/permissions";
import {
  accountLinkingOptions,
  accountTypeHooksForPool,
  advancedCookieConfig,
  isStepUpFresh,
  magicLinkOptions,
  microsoftEmailFromProfile,
  sharedSessionOptions,
  stampMicrosoftTenantId,
  stepUpRequiredForRequest,
  STEP_UP_REFRESH_PATHS,
  userAdditionalFields,
  type BaseAuthConfig,
} from "./shared";

export type SecurityAlert = {
  event: "new-device-sign-in";
  /** The signing-in host. */
  userId: string;
  userEmail: string;
  ip: string | null;
  userAgent: string | null;
  /** Emails of the org's owners (includes the user if they are one). */
  ownerEmails: string[];
};

export type HostAuthConfig = BaseAuthConfig & {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  /**
   * Sign-in from a device with no prior sign-in on record notifies all org
   * owners (task 17). Optional so tests and tooling can construct the
   * instance without a mail transport; when absent, the event is still
   * written to audit_log.
   */
  sendSecurityAlert?: (alert: SecurityAlert) => Promise<void>;
};

const STEP_UP_MESSAGE =
  "This action requires recent verification. Confirm with your passkey or authenticator code and try again.";

/**
 * Auth instance for apps/business (host portal). Mounts the organization
 * plugin (with the shared access-control statement from packages/authz),
 * the admin plugin (staff endpoints; every admin-plugin user field is
 * input:false, so `role` cannot be set at signup — verified against 1.6.25
 * schema source), passkeys, and TOTP two-factor (which owns recovery codes —
 * the passkey plugin has none; verified against plugin source).
 */
export function createHostAuth(config: HostAuthConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const secureCookies = config.baseURL.startsWith("https://");
  const baseHooks = accountTypeHooksForPool(pool, "business");

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

  /** Authoritative step-up freshness: DB read, never the cookie cache. */
  const sessionHasFreshStepUp = async (sessionId: string) => {
    const result = await pool.query<{ lastVerifiedAt: Date | null }>(
      `SELECT "lastVerifiedAt" FROM "session" WHERE id = $1`,
      [sessionId],
    );
    return isStepUpFresh(result.rows[0]?.lastVerifiedAt);
  };

  /**
   * New-device detection (task 17): every sign-in is recorded in audit_log;
   * a sign-in whose user-agent has never been seen for this user notifies
   * all org owners. audit_log survives session expiry, so a routine
   * next-day sign-in from the same browser is not a false positive.
   */
  const recordSignInAndAlert = async (session: {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => {
    const ua = session.userAgent ?? null;
    const seen = await pool.query(
      `SELECT 1 FROM audit_log
       WHERE action = 'auth.sign-in' AND actor_user_id = $1
         AND user_agent IS NOT DISTINCT FROM $2
       LIMIT 1`,
      [session.userId, ua],
    );
    const isNewDevice = seen.rowCount === 0;
    await pool.query(
      `INSERT INTO audit_log (action, actor_user_id, ip, user_agent, detail)
       VALUES ('auth.sign-in', $1, $2, $3, $4)`,
      [
        session.userId,
        session.ipAddress ?? null,
        ua,
        JSON.stringify({ newDevice: isNewDevice }),
      ],
    );
    if (!isNewDevice || !config.sendSecurityAlert) return;
    const owners = await pool.query<{ email: string }>(
      `SELECT DISTINCT u.email
       FROM "member" me
       JOIN "member" mo ON mo."organizationId" = me."organizationId" AND mo.role = 'owner'
       JOIN "user" u ON u.id = mo."userId"
       WHERE me."userId" = $1`,
      [session.userId],
    );
    const user = await pool.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = $1`,
      [session.userId],
    );
    const userEmail = user.rows[0]?.email;
    if (!userEmail) return;
    await config.sendSecurityAlert({
      event: "new-device-sign-in",
      userId: session.userId,
      userEmail,
      ip: session.ipAddress ?? null,
      userAgent: ua,
      ownerEmails: owners.rows.map((row) => row.email),
    });
  };

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: pool,
    user: { additionalFields: userAdditionalFields },
    session: {
      // Shorter lifetime than the guest app (task 17): idle host sessions
      // die after 24h; activity extends them hourly.
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60,
      // Shorter cache than the guest app's 5 minutes: a demoted admin
      // retains the permissions baked into the signed cookie until it
      // expires, so the host portal caps that exposure at 60s (plus
      // explicit revocation in the member hooks below).
      cookieCache: {
        enabled: true,
        maxAge: 60,
      },
      additionalFields: {
        ...sharedSessionOptions.additionalFields,
        lastVerifiedAt: {
          type: "date",
          required: false,
          input: false,
        },
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
      ...baseHooks,
      session: {
        create: {
          before: async (session) => {
            const result = await baseHooks.session.create.before(session);
            // Signing in IS a verification: the step-up clock starts now.
            return { data: { ...result.data, lastVerifiedAt: new Date() } };
          },
          after: async (session) => {
            try {
              await recordSignInAndAlert(session);
            } catch (err) {
              // Alerting must never block a sign-in.
              console.error("[auth] new-device alert failed:", err);
            }
          },
        },
      },
      account: {
        create: {
          before: async (account) => stampMicrosoftTenantId(account),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Step-up gate (task 14). Recency, not passkey presence: a stale
        // session gets 403 STEP_UP_REQUIRED and must re-verify (passkey,
        // TOTP, backup code — or a fresh sign-in for hosts with no second
        // factor enrolled yet).
        if (stepUpRequiredForRequest(ctx.path, ctx.body)) {
          const session = await getSessionFromCtx(ctx);
          if (session && !(await sessionHasFreshStepUp(session.session.id))) {
            throw new APIError("FORBIDDEN", {
              message: STEP_UP_MESSAGE,
              code: "STEP_UP_REQUIRED",
            });
          }
        }
        // Org policy can require every member to keep at least one passkey
        // (org_profile.auth_policy, task 14).
        if (ctx.path === "/passkey/delete-passkey") {
          const session = await getSessionFromCtx(ctx);
          if (session) {
            const policy = await pool.query(
              `SELECT 1
               FROM org_profile op
               JOIN "member" m ON m."organizationId" = op.organization_id
               WHERE m."userId" = $1 AND (op.auth_policy->>'requirePasskey') = 'true'
               LIMIT 1`,
              [session.user.id],
            );
            if (policy.rowCount && policy.rowCount > 0) {
              const count = await pool.query<{ n: string }>(
                `SELECT count(*)::text AS n FROM "passkey" WHERE "userId" = $1`,
                [session.user.id],
              );
              if (Number(count.rows[0]?.n ?? 0) <= 1) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Your organization requires a passkey on every account. Add another passkey before deleting this one.",
                });
              }
            }
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // A successful re-verification restarts the step-up clock. After
        // hooks only run on success — a failed verify throws before this.
        if ((STEP_UP_REFRESH_PATHS as readonly string[]).includes(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          if (session) {
            await pool.query(
              `UPDATE "session" SET "lastVerifiedAt" = NOW() WHERE id = $1`,
              [session.session.id],
            );
          }
        }
      }),
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
      passkey({
        rpID: new URL(config.baseURL).hostname,
        rpName: "OpenBookings",
        origin: config.baseURL,
      }),
      // TOTP fallback for step-up, and the owner of recovery codes: backup
      // codes are generated when a host enables two-factor (the passkey
      // plugin exposes none — verified against plugin source).
      twoFactor({
        issuer: "OpenBookings",
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
 * Recovery cooldown (task 16, hard rule): no recovery path may change the
 * payout destination inside the cooldown window. Staff-triggered credential
 * resets write an audit_log row with action 'recovery.credential-reset';
 * the payout-destination endpoint must call this and refuse while it
 * returns a date in the future.
 */
export const RECOVERY_PAYOUT_COOLDOWN_HOURS = 72;

export async function payoutChangeBlockedUntil(
  queryOne: <T>(text: string, values?: unknown[]) => Promise<T | null>,
  userId: string,
): Promise<Date | null> {
  const row = await queryOne<{ created_at: Date | string }>(
    `SELECT created_at FROM audit_log
     WHERE action = 'recovery.credential-reset' AND target_user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!row) return null;
  const until = new Date(
    new Date(row.created_at).getTime() + RECOVERY_PAYOUT_COOLDOWN_HOURS * 3600 * 1000,
  );
  return until.getTime() > Date.now() ? until : null;
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
