import type { apple } from "better-auth/social-providers";
import { namesFromApple } from "./names";

type AppleProfile = Awaited<ReturnType<ReturnType<typeof apple>["getUserInfo"]>> extends infer R
  ? NonNullable<R> extends { data: infer D } ? D : never
  : never;

/**
 * Apple `getUserInfo` for the guest instance. It mirrors better-auth 1.7.27's
 * default (@better-auth/core/dist/social-providers/apple.mjs), which the
 * default would otherwise run, and only ADDS firstName/lastName:
 *
 *   if (!token.idToken) return null;
 *   const profile = decodeJwt(token.idToken);
 *   if (!profile) return null;
 *   let name;
 *   if (token.user?.name) name = `${token.user.name.firstName || ""} ${token.user.name.lastName || ""}`.trim();
 *   else name = profile.name || "";
 *   const emailVerified = parseStringBoolean(profile.email_verified) ?? false;
 *   const enrichedProfile = { ...profile, name };
 *   return { user: { name: enrichedProfile.name, emailVerified, email: profile.email, ...userMap },
 *            data: enrichedProfile };
 *
 * The default only decodes the id token (no signature check; it came straight
 * from Apple's token endpoint), and so does this. Apple sends `user.name` on
 * the very first sign-in only: later sign-ins give no firstName/lastName keys,
 * so names the guest has set are left alone.
 */
export type AppleToken = {
  idToken?: string | undefined;
  user?: { name?: { firstName?: string; lastName?: string } | undefined } | undefined;
};

/** jose's `decodeJwt`: unverified payload of a compact JWS, which must be a JSON object. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const json = Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const payload: unknown = JSON.parse(json);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid JWT");
  }
  return payload as Record<string, unknown>;
}

/** better-auth's `parseStringBoolean` (core/dist/oauth2/utils.mjs). */
function parseStringBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

export async function appleUserInfo(token: AppleToken) {
  if (!token.idToken) return null;
  const profile = decodeJwtPayload(token.idToken);
  let name: string;
  if (token.user?.name) {
    name = `${token.user.name.firstName || ""} ${token.user.name.lastName || ""}`.trim();
  } else {
    name = (profile.name as string | undefined) || "";
  }
  const emailVerified = parseStringBoolean(profile.email_verified) ?? false;
  const enrichedProfile = { ...profile, name } as unknown as AppleProfile;
  const names = namesFromApple(token.user);
  return {
    user: {
      name: enrichedProfile.name,
      emailVerified,
      email: profile.email as string | undefined,
      ...(names ?? {}),
    },
    data: enrichedProfile,
  };
}
