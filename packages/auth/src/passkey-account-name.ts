import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The account name a device stores beside a new passkey is always the host's
 * email — it is what the browser shows when offering the passkey at sign-in,
 * so it has to say which account this is.
 *
 * The plugin would otherwise use the passkey's label for it: the client sends
 * one `name` for both. The label still reaches `/passkey/verify-registration`
 * in the body and is stored as the passkey's name; it is only for telling
 * passkeys apart on the security page.
 *
 * Returns the context override for a before-hook, or nothing for any other
 * request.
 */
export async function passkeyAccountName(ctx: HookContext) {
  if (ctx.path !== "/passkey/generate-register-options") return;
  const session = await getSessionFromCtx(ctx);
  if (!session?.user.email) return;
  return { context: { query: { ...ctx.query, name: session.user.email } } };
}
