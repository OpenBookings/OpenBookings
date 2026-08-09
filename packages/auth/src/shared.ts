import { APIError, type User, type Session } from "better-auth";
import { Pool } from "pg";

/**
 * Shared building blocks for the two Better Auth instances. This module is
 * server-only in spirit; it is imported by `guest.ts` and `host.ts`, never
 * by client code. (A literal `import "server-only"` breaks bun test and the
 * middleware bundle, so the guard is a runtime check instead.)
 */
if (typeof window !== "undefined") {
  throw new Error("@openbookings/auth server modules must not be bundled for the browser");
}

/** Config both factories share. Cookie prefix is required — see env.ts. */
export type BaseAuthConfig = {
  baseURL: string;
  secret: string;
  databaseUrl: string;
  sendMagicLink: (email: string, url: string) => Promise<void>;
  /**
   * Cookie namespace for this instance ("ob-guest" / "ob-host"). Required and
   * sourced from validated env — a shared or defaulted prefix would put both
   * apps' sessions in the same cookies and collapse the host/guest boundary.
   */
  cookiePrefix: string;
  trustedOrigins?: string[];
  dashApiKey?: string;
};

/** Which portal a given account_type belongs to. */
export const PORTAL_BY_ACCOUNT_TYPE: Record<string, "guest" | "host"> = {
  private: "guest",
  business: "host",
};

export function portalForAccountType(
  accountType: string,
): "guest" | "host" | undefined {
  return PORTAL_BY_ACCOUNT_TYPE[accountType];
}

/**
 * True when a user with `actual` account_type may sign in on an app that
 * requires `required`. NULL/missing account_type is rejected — a missing
 * value means the row predates enforcement and needs manual review, not
 * silent access.
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

type SessionResult<
  U extends Record<string, unknown>,
  S extends Record<string, unknown>,
> = { user: U; session: S } | null | undefined;

/**
 * Per-request gate: the session-creation hook fires once, but an
 * already-issued cookie presented to the other app must be re-checked on
 * every read. Returns the session only when both the user's account_type and
 * the session's portal stamp match this app; anything else — including a
 * portal stamp from the other app on a session row — resolves to null so
 * callers treat the request as unauthenticated.
 *
 * A NULL portal is tolerated (sessions created before the portal column
 * existed); account_type remains the primary gate for those until they
 * expire.
 */
export function sessionForApp<
  U extends { account_type?: string | null },
  S extends { portal?: string | null },
>(
  result: SessionResult<U & Record<string, unknown>, S & Record<string, unknown>>,
  requiredAccountType: string,
): { user: U & Record<string, unknown>; session: S & Record<string, unknown> } | null {
  if (!result) return null;
  if (!isAccountTypeAllowed(requiredAccountType, result.user.account_type)) {
    return null;
  }
  const expectedPortal = portalForAccountType(requiredAccountType);
  const portal = result.session.portal;
  if (portal != null && portal !== expectedPortal) return null;
  return result;
}

/**
 * Full cookie names this instance sets, for middleware that needs to expire
 * them on an account-type mismatch. Mirrors better-auth's naming: in
 * production the four core cookies carry the browser-enforced __Host- prefix
 * (see `advancedCookieConfig`), in dev they are `${prefix}.${name}`.
 */
export function sessionCookieNames(
  cookiePrefix: string,
  secure: boolean,
): string[] {
  const core = ["session_token", "session_data", "account_data", "dont_remember"];
  return core.map((name) =>
    secure ? `__Host-${cookiePrefix}.${name}` : `${cookiePrefix}.${name}`,
  );
}

/**
 * Cookie isolation between the guest and host apps.
 *
 * - Distinct `cookiePrefix` per instance, no default.
 * - `crossSubDomainCookies` disabled — a Domain=.openbookings.co cookie would
 *   be sent to both apps.
 * - In production the four core cookies are named with the __Host- prefix,
 *   which the browser only accepts with Secure, Path=/, and no Domain
 *   attribute (better-call enforces those at serialization). better-auth's
 *   automatic __Secure- prefix is turned off so names don't double-prefix;
 *   `defaultCookieAttributes.secure` keeps Secure on any non-core cookie a
 *   plugin creates (OAuth state etc.).
 */
export function advancedCookieConfig(cookiePrefix: string, secure: boolean) {
  if (!secure) {
    return {
      cookiePrefix,
      crossSubDomainCookies: { enabled: false as const },
    };
  }
  const hostNamed = (name: string) => ({
    name: `__Host-${cookiePrefix}.${name}`,
    attributes: { secure: true },
  });
  return {
    cookiePrefix,
    crossSubDomainCookies: { enabled: false as const },
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true },
    cookies: {
      session_token: hostNamed("session_token"),
      session_data: hostNamed("session_data"),
      account_data: hostNamed("account_data"),
      dont_remember: hostNamed("dont_remember"),
    },
  };
}

/**
 * Builds the databaseHooks that enforce account_type separation. Better Auth
 * runs `session.create.before` for every sign-in method — password, magic
 * link, and OAuth callbacks — so this is the single enforcement point at
 * session creation; `sessionForApp` re-checks on every read. The hook also
 * stamps the session row with the portal it was created for.
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
          return {
            data: { ...session, portal: portalForAccountType(accountType) },
          };
        },
      },
    },
  };
}

/** account_type hooks wired to a live pg pool. */
export function accountTypeHooksForPool(pool: Pool, accountType: string) {
  return buildAccountTypeHooks(accountType, async (userId) => {
    const result = await pool.query<{ account_type: string | null }>(
      `SELECT account_type FROM "user" WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.account_type;
  });
}

/** `user.additionalFields` both instances share. Never client-settable. */
export const userAdditionalFields = {
  account_type: {
    type: "string",
    required: false,
    input: false,
  },
} as const;

/** `session` options both instances share (cookie cache + portal stamp). */
export const sharedSessionOptions = {
  cookieCache: {
    enabled: true,
    maxAge: 5 * 60,
  },
  additionalFields: {
    portal: {
      type: "string",
      required: false,
      input: false,
    },
  },
} as const;

export function magicLinkOptions(config: BaseAuthConfig) {
  return {
    sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
      await config.sendMagicLink(email, url);
    },
    expiresIn: 60 * 15,
  };
}
