import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { betterAuth } from "better-auth";
import { magicLink, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { passkey } from "@better-auth/passkey";
import { createStepUpHooks, MAX_FACTOR_FAILURES, type StepUpStore } from "./step-up-hooks";

/**
 * The step-up hooks against the real Better Auth dispatch, on a memory
 * database. The pure decision is tested in server.test.ts; what is tested here
 * is what those tests cannot see: which session a verification stamps, and
 * that only a SUCCESSFUL verification stamps anything.
 */

const BASE = "http://localhost:3000";
const SECRET = "x".repeat(40);
type Row = Record<string, any>;

function world() {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], passkey: [], twoFactor: [] };
  const failures: Array<{ userId: string; at: number }> = [];
  let lastMagic = "";

  const store: StepUpStore = {
    getState: async (sessionId) => {
      const s = db.session.find((r) => r.id === sessionId);
      if (!s) return null;
      const u = db.user.find((r) => r.id === s.userId);
      return {
        hasFactor: u?.twoFactorEnabled === true || db.passkey.some((p) => p.userId === s.userId),
        lastVerifiedAt: s.lastVerifiedAt ?? null,
        lastFactorVerifiedAt: s.lastFactorVerifiedAt ?? null,
      };
    },
    stampFactor: async (sessionId) => {
      const s = db.session.find((r) => r.id === sessionId);
      if (s) s.lastVerifiedAt = s.lastFactorVerifiedAt = new Date();
    },
    retireSession: async (sessionId) => {
      const i = db.session.findIndex((r) => r.id === sessionId);
      if (i >= 0) db.session.splice(i, 1);
    },
    recentFactorFailures: async (userId) => failures.filter((f) => f.userId === userId).length,
    recordFactorFailure: async (userId) => void failures.push({ userId, at: Date.now() }),
  };

  const hooks = createStepUpHooks(store);
  const auth = betterAuth({
    baseURL: BASE,
    secret: SECRET,
    database: memoryAdapter(db),
    rateLimit: { enabled: false },
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
      additionalFields: {
        lastVerifiedAt: { type: "date", required: false, input: false },
        lastFactorVerifiedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: { create: { before: async (s) => ({ data: { ...s, lastVerifiedAt: new Date() } }) } },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => hooks.before(ctx)),
      after: createAuthMiddleware(async (ctx) => hooks.after(ctx)),
    },
    plugins: [
      magicLink({ sendMagicLink: async ({ url }) => void (lastMagic = url) }),
      passkey({ rpID: "localhost", rpName: "t", origin: BASE }),
      twoFactor({ issuer: "t", allowPasswordless: true }),
    ],
  });

  class Jar {
    c = new Map<string, string>();
    header() {
      return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    take(res: Response) {
      for (const sc of res.headers.getSetCookie()) {
        const [kv, ...attrs] = sc.split(";");
        const i = kv!.indexOf("=");
        const k = kv!.slice(0, i).trim();
        const v = kv!.slice(i + 1);
        if (attrs.some((a) => /max-age=0/i.test(a)) || v === "") this.c.delete(k);
        else this.c.set(k, v);
      }
    }
    clone() {
      const j = new Jar();
      j.c = new Map(this.c);
      return j;
    }
  }

  async function call(jar: Jar, method: string, path: string, body?: unknown) {
    const res = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method,
        headers: { cookie: jar.header(), origin: BASE, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    jar.take(res);
    const json = (await res.clone().json().catch(() => null)) as Row | null;
    return { status: res.status, json };
  }

  async function signIn(email: string) {
    const jar = new Jar();
    await call(jar, "POST", "/sign-in/magic-link", { email });
    const res = await auth.handler(new Request(lastMagic, { headers: { cookie: jar.header() }, redirect: "manual" }));
    jar.take(res);
    return jar;
  }

  const sessionOf = async (jar: Jar) =>
    (await call(jar.clone(), "GET", "/get-session?disableCookieCache=true")).json?.session as Row;
  const row = (id: string) => db.session.find((r) => r.id === id);
  /** Make a session look like it was verified long ago. */
  const age = (id: string) => {
    const s = row(id)!;
    s.lastVerifiedAt = new Date(Date.now() - 60 * 60 * 1000);
    if (s.lastFactorVerifiedAt) s.lastFactorVerifiedAt = new Date(Date.now() - 60 * 60 * 1000);
  };

  /** A software passkey registered straight into the database. */
  function makePasskey(userId: string) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const x = Buffer.from(jwk.x!, "base64url");
    const y = Buffer.from(jwk.y!, "base64url");
    const cose = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x,
      Buffer.from([0x22, 0x58, 0x20]),
      y,
    ]);
    const credentialID = crypto.randomBytes(16).toString("base64url");
    db.passkey.push({
      id: crypto.randomUUID(), name: "soft", userId, credentialID, publicKey: cose.toString("base64"),
      counter: 0, deviceType: "singleDevice", backedUp: false, transports: "internal", createdAt: new Date(),
    });
    return { credentialID, privateKey };
  }

  async function passkeyVerify(jar: Jar, pk: { credentialID: string; privateKey: crypto.KeyObject }) {
    const opts = await call(jar, "GET", "/passkey/generate-authenticate-options");
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: opts.json!.challenge, origin: BASE, crossOrigin: false }),
    );
    const authData = Buffer.concat([
      crypto.createHash("sha256").update("localhost").digest(),
      Buffer.from([0x05]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const signed = Buffer.concat([authData, crypto.createHash("sha256").update(clientDataJSON).digest()]);
    const signature = crypto.createSign("SHA256").update(signed).sign(pk.privateKey);
    return call(jar, "POST", "/passkey/verify-authentication", {
      response: {
        id: pk.credentialID, rawId: pk.credentialID, type: "public-key",
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      },
    });
  }

  async function totpCode(userId: string) {
    const tf = db.twoFactor.find((t) => t.userId === userId)!;
    const raw = await symmetricDecrypt({ key: SECRET, data: tf.secret });
    return (await auth.api.generateTOTP({ body: { secret: raw } })).code;
  }

  /** A host with TOTP fully enrolled; returns their jar. */
  async function totpHost(email: string) {
    const jar = await signIn(email);
    const s = await sessionOf(jar);
    await call(jar, "POST", "/two-factor/enable", {});
    await call(jar, "POST", "/two-factor/verify-totp", { code: await totpCode(s.userId) });
    return { jar, userId: s.userId as string };
  }

  return { db, call, signIn, sessionOf, row, age, makePasskey, passkeyVerify, totpCode, totpHost };
}

describe("step-up hooks", () => {
  test("signing in starts the sign-in clock only", async () => {
    const w = world();
    const s = await w.sessionOf(await w.signIn("host@example.com"));
    expect(w.row(s.id)!.lastVerifiedAt).toBeInstanceOf(Date);
    expect(w.row(s.id)!.lastFactorVerifiedAt ?? null).toBeNull();
  });

  test("a FAILED verification stamps nothing: a stolen cookie and a garbage request do not pass the gate", async () => {
    const w = world();
    const jar = await w.signIn("host@example.com");
    const s = await w.sessionOf(jar);
    w.makePasskey(s.userId);

    expect((await w.call(jar, "POST", "/two-factor/verify-totp", { code: "000000" })).status).toBeGreaterThanOrEqual(400);
    expect((await w.call(jar, "POST", "/two-factor/verify-backup-code", { code: "nope-nope" })).status).toBeGreaterThanOrEqual(400);
    expect((await w.call(jar, "POST", "/two-factor/verify-totp", {})).status).toBeGreaterThanOrEqual(400);
    expect((await w.call(jar, "POST", "/passkey/verify-authentication", { response: { id: "x" } })).status).toBeGreaterThanOrEqual(400);

    expect(w.row(s.id)!.lastFactorVerifiedAt ?? null).toBeNull();
    expect((await w.call(jar, "POST", "/two-factor/enable", {})).json?.code).toBe("STEP_UP_REQUIRED");
  });

  test("a host with a passkey is refused after a mere sign-in, and let through after using the passkey", async () => {
    const w = world();
    const jar = await w.signIn("host@example.com");
    const before = await w.sessionOf(jar);
    const pk = w.makePasskey(before.userId);

    const refused = await w.call(jar, "POST", "/two-factor/enable", {});
    expect(refused.status).toBe(403);
    expect(refused.json?.code).toBe("STEP_UP_REQUIRED");

    expect((await w.passkeyVerify(jar, pk)).status).toBe(200);
    const after = await w.sessionOf(jar);
    // The session the browser now holds is the one that was verified...
    expect(w.row(after.id)!.lastFactorVerifiedAt).toBeInstanceOf(Date);
    // ...and the one it replaced is gone, not left alive and "fresh".
    expect(w.row(before.id)).toBeUndefined();
    expect(w.db.session.filter((r) => r.userId === before.userId).length).toBe(1);

    expect((await w.call(jar, "POST", "/two-factor/enable", {})).status).toBe(200);
  });

  test("someone else's passkey does nothing for the session it was presented with", async () => {
    const w = world();
    const victim = await w.signIn("victim@example.com");
    const v = await w.sessionOf(victim);
    w.makePasskey(v.userId);
    const attacker = await w.signIn("attacker@example.com");
    const attackerKey = w.makePasskey((await w.sessionOf(attacker)).userId);

    // The attacker replays the victim's cookie and verifies with their OWN passkey.
    const stolen = victim.clone();
    await w.passkeyVerify(stolen, attackerKey);

    expect(w.row(v.id)).toBeDefined();
    expect(w.row(v.id)!.lastFactorVerifiedAt ?? null).toBeNull();
    expect((await w.call(victim.clone(), "POST", "/two-factor/enable", {})).json?.code).toBe("STEP_UP_REQUIRED");
  });

  test("a host with no factor can still enrol their first one after a recent sign-in", async () => {
    const w = world();
    const jar = await w.signIn("new@example.com");
    expect((await w.call(jar, "POST", "/two-factor/enable", {})).status).toBe(200);
  });

  test("a host with no factor and an old session is asked to sign in again", async () => {
    const w = world();
    const jar = await w.signIn("new@example.com");
    w.age((await w.sessionOf(jar)).id);
    expect((await w.call(jar, "POST", "/two-factor/enable", {})).json?.code).toBe("STEP_UP_REQUIRED");
  });

  test("finishing authenticator enrolment counts as a verification on the session it leaves you with", async () => {
    const w = world();
    const { jar } = await w.totpHost("totp@example.com");
    const s = await w.sessionOf(jar);
    expect(w.row(s.id)!.lastFactorVerifiedAt).toBeInstanceOf(Date);
    expect((await w.call(jar, "POST", "/two-factor/generate-backup-codes", {})).status).toBe(200);
  });

  test("an authenticator code re-verifies a signed-in host", async () => {
    const w = world();
    const { jar, userId } = await w.totpHost("totp@example.com");
    w.age((await w.sessionOf(jar)).id);
    expect((await w.call(jar, "POST", "/two-factor/disable", {})).json?.code).toBe("STEP_UP_REQUIRED");

    expect((await w.call(jar, "POST", "/two-factor/verify-totp", { code: await w.totpCode(userId) })).status).toBe(200);
    const s = await w.sessionOf(jar);
    expect(w.row(s.id)!.lastFactorVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  test("the authenticator secret is never handed to a session", async () => {
    const w = world();
    const { jar } = await w.totpHost("totp@example.com");
    const res = await w.call(jar, "POST", "/two-factor/get-totp-uri", {});
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain("otpauth");
  });

  test("a new passkey is refused before the device ceremony, not after it", async () => {
    const w = world();
    const jar = await w.signIn("host@example.com");
    w.makePasskey((await w.sessionOf(jar)).userId);
    const res = await w.call(jar, "GET", "/passkey/generate-register-options");
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe("STEP_UP_REQUIRED");
  });

  test("wrong codes from a signed-in session lock further attempts, even a right one", async () => {
    const w = world();
    const { jar, userId } = await w.totpHost("totp@example.com");
    for (let i = 0; i < MAX_FACTOR_FAILURES; i++) {
      await w.call(jar, "POST", "/two-factor/verify-totp", { code: "000000" });
    }
    const locked = await w.call(jar, "POST", "/two-factor/verify-totp", { code: await w.totpCode(userId) });
    expect(locked.status).toBe(429);
  });
});
