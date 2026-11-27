import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isSuperAdminEnabled } from "./super-admin";

/** Header the proxy sets to the verified staff email. Never trust a client-sent one. */
export const STAFF_EMAIL_HEADER = "x-admin-email";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

export type AccessConfig = { teamDomain: string; aud: string };

export function accessConfig(
  env: Record<string, string | undefined> = process.env,
): AccessConfig | null {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) return null;
  return { teamDomain, aud };
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function defaultKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeys.set(teamDomain, keys);
  }
  return keys;
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: "missing" | "invalid" };

export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  keys: JWTVerifyGetKey = defaultKeys(cfg.teamDomain),
): Promise<AccessResult> {
  if (!token) return { ok: false, reason: "missing" };
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${cfg.teamDomain}`,
      audience: cfg.aud,
      algorithms: ["RS256"],
    });
    const email = payload.email;
    if (typeof email !== "string" || email === "") return { ok: false, reason: "invalid" };
    return { ok: true, email: email.toLowerCase() };
  } catch (error) {
    // The jose error code, else the error's name (never the token), so a misconfigured deployment can be diagnosed.
    const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
    console.warn("[admin access]", typeof code === "string" ? code : typeof name === "string" ? name : "unknown");
    return { ok: false, reason: "invalid" };
  }
}

export type Decision =
  | { kind: "allow"; headers: Headers }
  | { kind: "deny"; status: 403 | 404 | 503; body: string };

/** Pure request gate: decides, and builds the headers to forward on success. */
export async function decide(
  incoming: Headers,
  env: Record<string, string | undefined>,
  verify: (token: string | null, cfg: AccessConfig) => Promise<AccessResult> = verifyAccessJwt,
): Promise<Decision> {
  const headers = new Headers(incoming);
  headers.delete(STAFF_EMAIL_HEADER);
  headers.delete(ACCESS_EMAIL_HEADER);

  if (env.NODE_ENV !== "production") {
    if (!isSuperAdminEnabled(env)) return { kind: "deny", status: 404, body: "Not found" };
    headers.set(STAFF_EMAIL_HEADER, env.ADMIN_DEV_EMAIL?.trim().toLowerCase() || "dev@localhost");
    return { kind: "allow", headers };
  }

  const cfg = accessConfig(env);
  if (!cfg) return { kind: "deny", status: 503, body: "Admin is not configured" };
  const result = await verify(incoming.get(ACCESS_JWT_HEADER), cfg);
  if (!result.ok) return { kind: "deny", status: 403, body: "Forbidden" };
  headers.set(STAFF_EMAIL_HEADER, result.email);
  return { kind: "allow", headers };
}
