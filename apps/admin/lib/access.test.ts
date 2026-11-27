import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { STAFF_EMAIL_HEADER, accessConfig, decide, verifyAccessJwt } from "./access";

const cfg = { teamDomain: "openbookings.cloudflareaccess.com", aud: "aud-123" };

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  key: CryptoKey,
  o: { aud?: string; iss?: string; exp?: string | number; email?: string } = {},
) {
  return new SignJWT({ email: o.email ?? "Wouter@Example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setAudience(o.aud ?? cfg.aud)
    .setIssuer(o.iss ?? `https://${cfg.teamDomain}`)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(key);
}

describe("verifyAccessJwt", () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test("logs the error code, never the token, when verification fails", async () => {
    const { privateKey, keys } = await setup();
    const token = await sign(privateKey, { aud: "other" });
    expect(await verifyAccessJwt(token, cfg, keys)).toEqual({ ok: false, reason: "invalid" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(["[admin access]", "ERR_JWT_CLAIM_VALIDATION_FAILED"]);
  });

  test("logs the error name when the error has no jose code", async () => {
    const { privateKey } = await setup();
    const token = await sign(privateKey);
    const failingKeys = async () => {
      throw new TypeError("network down");
    };
    expect(await verifyAccessJwt(token, cfg, failingKeys)).toEqual({ ok: false, reason: "invalid" });
    expect(warn.mock.calls[0]).toEqual(["[admin access]", "TypeError"]);
  });

  test("accepts a token for our audience and issuer", async () => {
    const { privateKey, keys } = await setup();
    const r = await verifyAccessJwt(await sign(privateKey), cfg, keys);
    expect(r).toEqual({ ok: true, email: "wouter@example.com" });
  });

  test("refuses a missing token", async () => {
    const { keys } = await setup();
    expect(await verifyAccessJwt(null, cfg, keys)).toEqual({ ok: false, reason: "missing" });
  });

  test("refuses another audience", async () => {
    const { privateKey, keys } = await setup();
    const r = await verifyAccessJwt(await sign(privateKey, { aud: "other" }), cfg, keys);
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  test("refuses another issuer", async () => {
    const { privateKey, keys } = await setup();
    const r = await verifyAccessJwt(await sign(privateKey, { iss: "https://evil.example.com" }), cfg, keys);
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  test("refuses an expired token", async () => {
    const { privateKey, keys } = await setup();
    const past = Math.floor(Date.now() / 1000) - 3600;
    const r = await verifyAccessJwt(await sign(privateKey, { exp: past }), cfg, keys);
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  test("refuses a token signed by another key", async () => {
    const { keys } = await setup();
    const other = await setup();
    const r = await verifyAccessJwt(await sign(other.privateKey), cfg, keys);
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("accessConfig", () => {
  test("returns null when either variable is missing", () => {
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: "t.example.com" })).toBeNull();
    expect(accessConfig({ CF_ACCESS_AUD: "a" })).toBeNull();
    expect(accessConfig({})).toBeNull();
  });

  test("returns both values when set", () => {
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: "t.example.com", CF_ACCESS_AUD: "a" })).toEqual({
      teamDomain: "t.example.com",
      aud: "a",
    });
  });
});

describe("decide", () => {
  const prodEnv = {
    NODE_ENV: "production",
    ADMIN_SUPER_MODE: "1",
    CF_ACCESS_TEAM_DOMAIN: cfg.teamDomain,
    CF_ACCESS_AUD: cfg.aud,
  };
  const verifyOk = async () => ({ ok: true as const, email: "staff@example.com" });
  const verifyNever = async () => {
    throw new Error("verify must not be called");
  };
  const req = (headers: Record<string, string> = {}) => new Headers(headers);

  test("production ignores ADMIN_SUPER_MODE and requires a token", async () => {
    const verify = async (token: string | null) =>
      token ? { ok: true as const, email: "staff@example.com" } : { ok: false as const, reason: "missing" as const };
    expect(await decide(req(), prodEnv, verify)).toEqual({ kind: "deny", status: 403, body: "Forbidden" });
  });

  test("production without Access configuration is a 503", async () => {
    const env = { NODE_ENV: "production", ADMIN_SUPER_MODE: "1" };
    expect(await decide(req(), env, verifyNever)).toEqual({
      kind: "deny",
      status: 503,
      body: "Admin is not configured",
    });
  });

  test("a client-sent x-admin-email is replaced by the verified email", async () => {
    const r = await decide(
      req({ [STAFF_EMAIL_HEADER]: "attacker@example.com", "cf-access-jwt-assertion": "t" }),
      prodEnv,
      verifyOk,
    );
    expect(r.kind).toBe("allow");
    if (r.kind === "allow") expect(r.headers.get(STAFF_EMAIL_HEADER)).toBe("staff@example.com");
  });

  test("development without ADMIN_SUPER_MODE is a 404", async () => {
    const r = await decide(req({ [STAFF_EMAIL_HEADER]: "attacker@example.com" }), { NODE_ENV: "development" }, verifyNever);
    expect(r).toEqual({ kind: "deny", status: 404, body: "Not found" });
  });

  test("development with ADMIN_SUPER_MODE sets the dev email over a spoofed header", async () => {
    const env = { NODE_ENV: "development", ADMIN_SUPER_MODE: "1" };
    const r = await decide(req({ [STAFF_EMAIL_HEADER]: "attacker@example.com" }), env, verifyNever);
    expect(r.kind).toBe("allow");
    if (r.kind === "allow") expect(r.headers.get(STAFF_EMAIL_HEADER)).toBe("dev@localhost");
  });

  test("development normalises the dev email and falls back when it is blank", async () => {
    const base = { NODE_ENV: "development", ADMIN_SUPER_MODE: "1" };
    const email = async (dev: string) => {
      const r = await decide(req(), { ...base, ADMIN_DEV_EMAIL: dev }, verifyNever);
      return r.kind === "allow" ? r.headers.get(STAFF_EMAIL_HEADER) : null;
    };
    expect(await email("  Dev@Example.COM ")).toBe("dev@example.com");
    expect(await email("")).toBe("dev@localhost");
    expect(await email("   ")).toBe("dev@localhost");
  });

  test("a client-sent cf-access-authenticated-user-email is stripped", async () => {
    const r = await decide(
      req({ "cf-access-authenticated-user-email": "attacker@example.com", "cf-access-jwt-assertion": "t" }),
      prodEnv,
      verifyOk,
    );
    expect(r.kind).toBe("allow");
    if (r.kind === "allow") expect(r.headers.has("cf-access-authenticated-user-email")).toBe(false);
  });

  test("the cf-access-jwt-assertion value is what gets verified", async () => {
    const seen: (string | null)[] = [];
    const verify = async (token: string | null) => {
      seen.push(token);
      return { ok: true as const, email: "staff@example.com" };
    };
    await decide(req({ "cf-access-jwt-assertion": "the.jwt.value" }), prodEnv, verify);
    expect(seen).toEqual(["the.jwt.value"]);
  });
});
