import { APIError } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * A host who has enrolled a passkey keeps at least one: it is the factor the
 * step-up gate asks for, and removing the only one would quietly drop the
 * account back to a recent sign-in as its strongest check. They add a second
 * one first, then remove the first.
 *
 * The security page refuses this before sending anything; that is a
 * convenience. This is the control.
 */
export async function refuseLastPasskeyRemoval(
  ctx: HookContext,
  countPasskeys: (userId: string) => Promise<number>,
): Promise<void> {
  if (ctx.path !== "/passkey/delete-passkey") return;
  const session = await getSessionFromCtx(ctx);
  if (!session) return;
  if ((await countPasskeys(session.user.id)) <= 1) {
    throw new APIError("CONFLICT", {
      message: "This is your only passkey. Add another passkey before removing this one.",
      code: "LAST_PASSKEY",
    });
  }
}
