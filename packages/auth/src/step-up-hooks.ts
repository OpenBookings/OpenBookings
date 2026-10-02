import { APIError } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import {
  STEP_UP_REFRESH_PATHS,
  stepUpRequiredForRequest,
  stepUpSatisfied,
} from "./shared";

/**
 * The step-up gate, as Better Auth hooks.
 *
 * Kept apart from host.ts, behind a small store interface, so it can be run
 * against the real Better Auth dispatch in tests. What it has to get right is
 * not visible from the pure decision function: which session a verification
 * stamps, and that only a successful one stamps anything.
 */

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export type StepUpState = {
  hasFactor: boolean;
  lastVerifiedAt: Date | string | null;
  lastFactorVerifiedAt: Date | string | null;
};

export type StepUpStore = {
  /** Read from the database, never the cookie cache. Null when the row is gone. */
  getState: (sessionId: string) => Promise<StepUpState | null>;
  /** Start both clocks on this session. */
  stampFactor: (sessionId: string) => Promise<void>;
  /** Delete a session that a re-verification has replaced. */
  retireSession: (sessionId: string) => Promise<void>;
  /** Failed factor checks for this user inside the lockout window. */
  recentFactorFailures: (userId: string) => Promise<number>;
  recordFactorFailure: (userId: string) => Promise<void>;
};

/** Wrong codes allowed from a signed-in session before further tries are refused. */
export const MAX_FACTOR_FAILURES = 5;

const STEP_UP_MESSAGE =
  "This action requires recent verification. Confirm with your passkey or authenticator code and try again.";

const PASSKEY_VERIFY = "/passkey/verify-authentication";
const CODE_VERIFY = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];

/**
 * Whether the endpoint failed. Better Auth runs after-hooks for failed
 * requests too: the endpoint's error is caught and handed over as the
 * "returned" value. Treating every after-hook as success is how a wrong code
 * would start the clock.
 */
function failed(returned: unknown): boolean {
  if (returned instanceof Error) return true;
  if (returned instanceof Response) return !returned.ok;
  const status = (returned as { status?: unknown; statusCode?: unknown } | null | undefined);
  const code = typeof status?.statusCode === "number" ? status.statusCode : status?.status;
  return typeof code === "number" && code >= 400;
}

export function createStepUpHooks(store: StepUpStore) {
  const refuse = () =>
    new APIError("FORBIDDEN", { message: STEP_UP_MESSAGE, code: "STEP_UP_REQUIRED" });

  return {
    async before(ctx: HookContext): Promise<void> {
      // Returns the authenticator secret to any session when hosts have no
      // password (allowPasswordless). A stolen cookie could read it, compute a
      // valid code and pass the gate. Nothing in the app calls it.
      if (ctx.path === "/two-factor/get-totp-uri") {
        throw new APIError("FORBIDDEN", { message: "Not available.", code: "NOT_AVAILABLE" });
      }

      // Gated: the listed actions, plus asking for passkey registration
      // options — so the refusal comes before the device ceremony, not after
      // the host has already created a credential that then cannot be saved.
      if (
        stepUpRequiredForRequest(ctx.path, ctx.body) ||
        ctx.path === "/passkey/generate-register-options"
      ) {
        const session = await getSessionFromCtx(ctx);
        if (session) {
          // Fail closed: no row, or a read that throws, is a refusal.
          const state = await store.getState(session.session.id).catch(() => null);
          if (!state || !stepUpSatisfied(state)) throw refuse();
        }
      }

      // A signed-in session guessing codes. The plugin only counts attempts
      // during sign-in, so without this a stolen cookie could try codes all
      // day. (No session means the sign-in flow, which the plugin limits.)
      if (CODE_VERIFY.includes(ctx.path)) {
        const session = await getSessionFromCtx(ctx);
        if (session && (await store.recentFactorFailures(session.user.id)) >= MAX_FACTOR_FAILURES) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many incorrect codes. Try again in a few minutes, or use your passkey.",
            code: "FACTOR_LOCKED",
          });
        }
      }
    },

    async after(ctx: HookContext): Promise<void> {
      if (!(STEP_UP_REFRESH_PATHS as readonly string[]).includes(ctx.path)) return;

      // The session the request arrived with (its cookie), and the one the
      // endpoint created, if it created one.
      const requestSession = await getSessionFromCtx(ctx).catch(() => null);
      const newSession = ctx.context.newSession ?? null;

      if (failed(ctx.context.returned)) {
        if (requestSession && CODE_VERIFY.includes(ctx.path)) {
          await store.recordFactorFailure(requestSession.user.id);
        }
        return;
      }

      if (ctx.path === PASSKEY_VERIFY) {
        // Passkey verification always signs in: it creates a session for the
        // passkey's owner, whoever's cookie the request carried. So the
        // verified session is the NEW one, and only that is stamped. Stamping
        // the request's session would let anyone's passkey vouch for it.
        if (!newSession) return;
        await store.stampFactor(newSession.session.id);

        // A host re-verifying while signed in has been moved onto the new
        // session; the one it replaces must not stay alive.
        if (
          requestSession &&
          requestSession.session.id !== newSession.session.id &&
          requestSession.user.id === newSession.user.id
        ) {
          await store.retireSession(requestSession.session.id);
        }
        return;
      }

      // Authenticator or backup code: checked against the session's own user.
      // Finishing enrolment replaces the session, so prefer the new one.
      const sessionId = newSession?.session.id ?? requestSession?.session.id;
      if (sessionId) await store.stampFactor(sessionId);
    },
  };
}
