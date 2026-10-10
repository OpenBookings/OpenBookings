import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { passkey } from "@better-auth/passkey";
import { passkeyAccountName } from "./passkey-account-name";

/**
 * Against the real Better Auth dispatch, like step-up-hooks.test.ts: what
 * matters is the options the device is actually handed.
 */

const BASE = "http://localhost:3000";

async function registerOptions(email: string, query: string) {
  let magic = "";
  const auth = betterAuth({
    baseURL: BASE,
    secret: "x".repeat(40),
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], passkey: [] }),
    rateLimit: { enabled: false },
    hooks: { before: createAuthMiddleware(async (ctx) => passkeyAccountName(ctx)) },
    plugins: [
      magicLink({ sendMagicLink: async ({ url }) => void (magic = url) }),
      passkey({ rpID: "localhost", rpName: "t", origin: BASE }),
    ],
  });

  await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { origin: BASE, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const signedIn = await auth.handler(new Request(magic, { redirect: "manual" }));
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const res = await auth.handler(
    new Request(`${BASE}/api/auth/passkey/generate-register-options${query}`, {
      headers: { cookie, origin: BASE },
    }),
  );
  return (await res.json()) as { user: { name: string; displayName: string } };
}

describe("passkey account name", () => {
  test("the device is given the host's email, whatever label the passkey gets", async () => {
    const options = await registerOptions("host@example.com", "?name=Front%20desk%20MacBook");
    expect(options.user.name).toBe("host@example.com");
    expect(options.user.displayName).toBe("host@example.com");
  });

  test("and the same with no label at all", async () => {
    const options = await registerOptions("host@example.com", "");
    expect(options.user.name).toBe("host@example.com");
  });
});
