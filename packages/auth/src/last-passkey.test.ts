import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { passkey } from "@better-auth/passkey";
import { refuseLastPasskeyRemoval } from "./last-passkey";

/**
 * Against the real Better Auth dispatch, like step-up-hooks.test.ts: the
 * security page blocks this too, but only the server's answer is a control.
 */

const BASE = "http://localhost:3000";
type Row = Record<string, unknown>;

async function world(passkeyCount: number) {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  let magic = "";
  const auth = betterAuth({
    baseURL: BASE,
    secret: "x".repeat(40),
    database: memoryAdapter(db),
    rateLimit: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) =>
        refuseLastPasskeyRemoval(
          ctx,
          async (userId) => db.passkey.filter((p) => p.userId === userId).length,
        ),
      ),
    },
    plugins: [
      magicLink({ sendMagicLink: async ({ url }) => void (magic = url) }),
      passkey({ rpID: "localhost", rpName: "t", origin: BASE }),
    ],
  });

  await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { origin: BASE, "content-type": "application/json" },
      body: JSON.stringify({ email: "host@example.com" }),
    }),
  );
  const signedIn = await auth.handler(new Request(magic, { redirect: "manual" }));
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const userId = db.user[0].id as string;
  for (let i = 0; i < passkeyCount; i++) {
    db.passkey.push({
      id: `pk-${i}`,
      userId,
      name: `Key ${i}`,
      publicKey: "k",
      credentialID: `cred-${i}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: new Date(),
    });
  }

  const remove = (id: string) =>
    auth.handler(
      new Request(`${BASE}/api/auth/passkey/delete-passkey`, {
        method: "POST",
        headers: { cookie, origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    );

  return { db, remove };
}

describe("removing the last passkey", () => {
  test("is refused with a conflict, and the passkey stays", async () => {
    const { db, remove } = await world(1);
    const res = await remove("pk-0");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("LAST_PASSKEY");
    expect(db.passkey).toHaveLength(1);
  });

  test("is allowed while another one remains", async () => {
    const { db, remove } = await world(2);
    const res = await remove("pk-0");
    expect(res.status).toBe(200);
    expect(db.passkey.map((p) => p.id)).toEqual(["pk-1"]);
  });
});
