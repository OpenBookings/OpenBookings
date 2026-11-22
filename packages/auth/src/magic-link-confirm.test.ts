import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createGuestAuth } from "./guest";
import { createHostAuth } from "./host";
import {
  GUEST_MAGIC_LINK_CONFIRM_PATH,
  HOST_MAGIC_LINK_CONFIRM_PATH,
  magicLinkConfirmTarget,
  magicLinkEmail,
  magicLinkVerifyHref,
} from "./magic-link-confirm";

/**
 * GHSA-574j-vjcf-364v: a magic link opened from outside the app (webmail, a
 * chat, another site) stops at a confirm page that names the account, instead
 * of signing the browser in straight away.
 */

const BASE = "http://app.localhost:3002";
const SECRET = "test-secret-test-secret-test-secret-1234";
type Row = Record<string, any>;

function world(kind: "guest" | "host" = "guest") {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  const mail = { magic: "" };
  const base = {
    baseURL: BASE,
    secret: SECRET,
    databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
    sendMagicLink: async (_email: string, url: string) => void (mail.magic = url),
  };
  const options =
    kind === "guest"
      ? createGuestAuth({
          ...base,
          cookiePrefix: "ob-guest",
          sendChangeEmailConfirmation: async () => {},
          sendVerificationEmail: async () => {},
        }).options
      : createHostAuth({ ...base, cookiePrefix: "ob-host" }).options;
  const auth = betterAuth({ ...options, database: memoryAdapter(db), databaseHooks: undefined, rateLimit: { enabled: false } });
  const open = (url: string, site?: string) =>
    auth.handler(new Request(url, { headers: site ? { "sec-fetch-site": site } : {}, redirect: "manual" }));
  return { db, mail, auth, open };
}

async function linkFor(w: ReturnType<typeof world>, email: string) {
  await w.auth.api.signInMagicLink({ body: { email, callbackURL: "/account" }, headers: new Headers() });
  return w.mail.magic;
}

describe("magicLinkConfirmTarget", () => {
  const url = `${BASE}/api/auth/magic-link/verify?token=abc&callbackURL=%2Faccount`;

  test("a click from webmail, a chat or another site goes to the confirm page", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(magicLinkConfirmTarget("/magic-link/verify", url, site, "/auth/confirm")).toBe(
        `${BASE}/auth/confirm?token=abc&callbackURL=%2Faccount`,
      );
    }
  });

  test("a click from the app's own confirm page goes through", () => {
    expect(magicLinkConfirmTarget("/magic-link/verify", url, "same-origin", "/auth/confirm")).toBeNull();
  });

  test("a request without fetch metadata goes through (server calls, old browsers)", () => {
    expect(magicLinkConfirmTarget("/magic-link/verify", url, null, "/auth/confirm")).toBeNull();
  });

  test("other paths are not touched", () => {
    expect(magicLinkConfirmTarget("/get-session", url, "cross-site", "/auth/confirm")).toBeNull();
  });
});

describe("magicLinkVerifyHref", () => {
  test("keeps only the verify parameters, as a same-origin path", () => {
    expect(
      magicLinkVerifyHref({ token: "abc", callbackURL: "/account", extra: "x", errorCallbackURL: ["/a", "/b"] }),
    ).toBe("/api/auth/magic-link/verify?token=abc&callbackURL=%2Faccount");
  });

  test("no token, no link", () => {
    expect(magicLinkVerifyHref({ callbackURL: "/account" })).toBeNull();
    expect(magicLinkVerifyHref({ token: "" })).toBeNull();
  });
});

for (const kind of ["guest", "host"] as const) {
  const confirmPath = kind === "guest" ? GUEST_MAGIC_LINK_CONFIRM_PATH : HOST_MAGIC_LINK_CONFIRM_PATH;

  describe(`${kind}: magic link opened from outside the app`, () => {
    test("redirects to the confirm page without using up the link or signing in", async () => {
      const w = world(kind);
      const link = await linkFor(w, "mallory@example.test");
      const res = await w.open(link, "cross-site");
      expect(res.status).toBe(302);
      const to = new URL(res.headers.get("location")!);
      expect(to.origin + to.pathname).toBe(`${BASE}${confirmPath}`);
      expect(to.searchParams.get("token")).toBe(new URL(link).searchParams.get("token"));
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(w.db.session).toHaveLength(0);
      expect(await magicLinkEmail(w.auth, to.searchParams.get("token")!)).toBe("mallory@example.test");
    });

    test("continuing from the confirm page signs in", async () => {
      const w = world(kind);
      const link = await linkFor(w, "jan@example.test");
      const res = await w.open(link, "same-origin");
      expect(res.status).toBe(302);
      expect(res.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);
      expect(w.db.session).toHaveLength(1);
    });
  });
}

describe("magicLinkEmail", () => {
  test("unknown, used and expired links give null", async () => {
    const w = world();
    expect(await magicLinkEmail(w.auth, "nope")).toBeNull();
    const link = await linkFor(w, "jan@example.test");
    const token = new URL(link).searchParams.get("token")!;
    w.db.verification[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await magicLinkEmail(w.auth, token)).toBeNull();
  });
});
