/**
 * Login CSRF on magic links (GHSA-574j-vjcf-364v).
 *
 * Better Auth's GET /magic-link/verify signs in whoever opens the link. So
 * someone could request a link for their own account and get another person
 * to open it: that person is then silently signed in to the sender's account
 * (and signed out of their own), and what they book or enter lands where the
 * sender can read it.
 *
 * A link opened from outside the app (webmail, a mail app, a chat, another
 * site) is therefore sent to a confirm page first. That page names the
 * account the link signs in to, warns when another account is signed in, and
 * continues to the verify URL from the app's own origin, which is let
 * through. The link is not used up until then, so mail scanners that open
 * links no longer burn it either.
 *
 * Requests without fetch metadata (server-side calls, tests, old browsers)
 * go through unchanged: there is no reliable signal to act on.
 */

export const MAGIC_LINK_VERIFY_PATH = "/magic-link/verify";
export const GUEST_MAGIC_LINK_CONFIRM_PATH = "/auth/confirm";
export const HOST_MAGIC_LINK_CONFIRM_PATH = "/login/confirm";

/** The query parameters the verify endpoint reads; nothing else is passed on. */
const VERIFY_PARAMS = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

/**
 * Where to send a magic-link click instead of signing in, or null to let it
 * through. `baseURL` is the app's origin (Better Auth's base URL works too).
 */
export function magicLinkConfirmTarget(
  path: string,
  requestUrl: string | undefined,
  secFetchSite: string | null | undefined,
  confirmPath: string,
  baseURL: string = requestUrl ?? "",
): string | null {
  if (path !== MAGIC_LINK_VERIFY_PATH || !requestUrl) return null;
  if (secFetchSite == null || secFetchSite === "same-origin") return null;
  const from = new URL(requestUrl);
  const to = new URL(confirmPath, baseURL);
  for (const key of VERIFY_PARAMS) {
    const value = from.searchParams.get(key);
    if (value != null) to.searchParams.set(key, value);
  }
  return to.toString();
}

/** The same-origin verify URL the confirm page's Continue button opens. */
export function magicLinkVerifyHref(params: Record<string, string | string[] | undefined>): string | null {
  const out = new URLSearchParams();
  for (const key of VERIFY_PARAMS) {
    const value = params[key];
    if (typeof value === "string" && value) out.set(key, value);
  }
  if (!out.get("token")) return null;
  return `/api/auth${MAGIC_LINK_VERIFY_PATH}?${out.toString()}`;
}

type VerificationLookup = {
  $context: Promise<{
    internalAdapter: {
      findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date | string } | null>;
    };
  }>;
};

/**
 * The email a still-valid magic link signs in to, or null when the link is
 * unknown, used or expired. Reads without consuming, through Better Auth's
 * own adapter, using the plugin's identifier format (plain token storage).
 */
export async function magicLinkEmail(auth: VerificationLookup, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const ctx = await auth.$context;
    const row = await ctx.internalAdapter.findVerificationValue(`magic-link:${token}`);
    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    const parsed = JSON.parse(row.value) as { email?: unknown };
    return typeof parsed.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}
