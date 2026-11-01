import { APIError } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Guests have no step-up clock (that is host-only, see step-up-hooks.ts). The
 * one thing a stolen guest cookie must not do is add its own passkey, which
 * would outlive the session and give a permanent way back in. So adding a
 * passkey needs a sign-in from the last 24 hours: the session row's
 * `createdAt`, read from the database by `getSessionFromCtx`'s session lookup.
 */
export const PASSKEY_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const REGISTRATION_PATHS = new Set(["/passkey/generate-register-options", "/passkey/verify-registration"]);

export function isSessionFreshForPasskey(
  createdAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!createdAt) return false;
  const at = new Date(createdAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at < PASSKEY_SESSION_MAX_AGE_MS;
}

/** The refusal for a registration request on a stale session, or null to let it through. */
export function passkeyRegistrationRefusal(
  path: string,
  sessionCreatedAt: Date | string | null | undefined,
  now: Date = new Date(),
): { code: "REAUTH_REQUIRED"; message: string } | null {
  if (!REGISTRATION_PATHS.has(path)) return null;
  if (isSessionFreshForPasskey(sessionCreatedAt, now)) return null;
  return { code: "REAUTH_REQUIRED", message: "For your security, sign in again to add a passkey." };
}

/** Before-hook: applies `passkeyRegistrationRefusal`. No session is left to the plugin (401). */
export async function refuseStalePasskeyRegistration(ctx: HookContext): Promise<void> {
  if (!REGISTRATION_PATHS.has(ctx.path)) return;
  const session = await getSessionFromCtx(ctx);
  if (!session) return;
  const refusal = passkeyRegistrationRefusal(ctx.path, session.session.createdAt);
  if (refusal) throw new APIError("FORBIDDEN", refusal);
}

/** Whether an endpoint's result is a failure. After-hooks also run for failed requests. */
export function endpointFailed(returned: unknown): boolean {
  if (returned instanceof Error) return true;
  if (returned instanceof Response) return !returned.ok;
  const status = returned as { status?: unknown; statusCode?: unknown } | null | undefined;
  const code = typeof status?.statusCode === "number" ? status.statusCode : status?.status;
  return typeof code === "number" && code >= 400;
}
