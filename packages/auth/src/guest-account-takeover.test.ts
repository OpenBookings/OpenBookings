import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createEmailVerificationToken } from "better-auth/api";
import { createGuestAuth } from "./guest";

/**
 * The real guest options on an in-memory database, driven over HTTP. Only the
 * database and the account-type hooks (which query Postgres) are swapped out;
 * every endpoint, before-hook and verification option is the production one.
 */

const BASE = "http://app.localhost:3002";
const SECRET = "test-secret-test-secret-test-secret-1234";
type Row = Record<string, any>;

function world() {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  const mail = { magic: "", confirm: "", verify: "" };
  const guest = createGuestAuth({
    baseURL: BASE,
    secret: SECRET,
    databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
    cookiePrefix: "ob-guest",
    sendMagicLink: async (_email, url) => void (mail.magic = url),
    sendChangeEmailConfirmation: async ({ url }) => void (mail.confirm = url),
    sendVerificationEmail: async ({ url }) => void (mail.verify = url),
  });
  const auth = betterAuth({
    ...guest.options,
    database: memoryAdapter(db),
    databaseHooks: undefined,
    rateLimit: { enabled: false },
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

  async function open(jar: Jar, url: string) {
    const res = await auth.handler(new Request(url, { headers: { cookie: jar.header() }, redirect: "manual" }));
    jar.take(res);
    return res;
  }

  /** A guest signing in the way the login-link route does it. */
  async function signIn(email: string) {
    const jar = new Jar();
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
    await open(jar, mail.magic);
    return jar;
  }

  const user = (email: string) => db.user.find((r) => r.email === email);

  return { db, mail, auth, Jar, call, open, signIn, user };
}

describe("guest email verification (GHSA-j524-cj9r-hjxv)", () => {
  test("a plain verify-email link no longer promotes an unverified row", async () => {
    const w = world();
    const now = new Date();
    w.db.user.push({ id: "squat", email: "victim@example.test", name: "", emailVerified: false, createdAt: now, updatedAt: now });
    w.db.account.push({ id: "acc", userId: "squat", providerId: "google", accountId: "attacker", createdAt: now, updatedAt: now });

    const token = await createEmailVerificationToken(SECRET, "victim@example.test", undefined, 3600, { userId: "squat" });
    const res = await w.open(new w.Jar(), `${BASE}/api/auth/verify-email?token=${token}`);

    expect(res.status).toBe(403);
    expect(w.user("victim@example.test")?.emailVerified).toBe(false);
  });

  test("changing email still works: confirm from the old inbox, verify from the new one", async () => {
    const w = world();
    const jar = await w.signIn("old@example.test");
    expect(w.user("old@example.test")?.emailVerified).toBe(true);

    const change = await w.call(jar, "POST", "/change-email", { newEmail: "new@example.test" });
    expect(change.status).toBe(200);
    expect(w.mail.confirm).toContain("/verify-email?token=");

    await w.open(jar, w.mail.confirm);
    expect(w.mail.verify).toContain("/verify-email?token=");

    await w.open(jar, w.mail.verify);
    expect(w.user("old@example.test")).toBeUndefined();
    expect(w.user("new@example.test")?.emailVerified).toBe(true);
  });
});

describe("passkey registration on an unverified row (GHSA-gv93-27wp-8wff)", () => {
  const dropCookieCache = (jar: { c: Map<string, string> }) => {
    for (const k of [...jar.c.keys()]) if (k.endsWith(".session_data")) jar.c.delete(k);
  };

  test("a fresh session on an unverified row cannot start adding a passkey", async () => {
    const w = world();
    const jar = await w.signIn("victim@example.test");
    // The squat: a session on a row whose email was never proven.
    w.user("victim@example.test")!.emailVerified = false;
    dropCookieCache(jar);

    const res = await w.call(jar, "GET", "/passkey/generate-register-options");
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe("EMAIL_NOT_VERIFIED");
  });

  test("a verified guest with a fresh session still can", async () => {
    const w = world();
    const jar = await w.signIn("guest@example.test");
    const res = await w.call(jar, "GET", "/passkey/generate-register-options");
    expect(res.status).toBe(200);
    expect(res.json?.challenge).toBeString();
  });
});
