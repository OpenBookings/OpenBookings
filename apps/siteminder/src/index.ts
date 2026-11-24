import { createHash, timingSafeEqual } from "node:crypto";
import { InstallationRegistrationSchema } from "@openbookings/apps-contract";
import { Hono, type Context, type Next } from "hono";
import { getPool } from "./db/pool";
import type { Queryable } from "./db/migrate";
import { assertRequiredEnv, env } from "./env";
import { removeInstallation, upsertInstallation } from "./installations";
import { type SoapDeps, defaultSoapDeps, handleSoap } from "./soap/route";

// Only when this file is the entrypoint — importing it (tests) must not
// require the production env set.
if (import.meta.main) assertRequiredEnv();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time bearer check: both sides hashed, so length never leaks. */
function hasBearer(header: string | undefined, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(sha256(presented), sha256(secret));
}

export function createApp(getDb: () => Queryable = getPool, soapDeps: SoapDeps = defaultSoapDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  const requireRegistrationSecret = async (c: Context, next: Next) => {
    if (!hasBearer(c.req.header("authorization"), env.registrationSecret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };

  app.post("/installations", requireRegistrationSecret, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = InstallationRegistrationSchema.safeParse(body);
    if (!parsed.success || !UUID.test(parsed.data.installationId)) {
      return c.json({ error: "invalid registration" }, 400);
    }
    await upsertInstallation(getDb(), parsed.data);
    return c.body(null, 204);
  });

  app.delete("/installations/:id", requireRegistrationSecret, async (c) => {
    const id = c.req.param("id") ?? "";
    // A malformed id cannot match a row; keep DELETE idempotent without a DB error.
    if (UUID.test(id)) await removeInstallation(getDb(), id);
    return c.body(null, 204);
  });

  app.post("/soap", (c) => handleSoap(c, getDb, soapDeps));

  return app;
}

export default createApp();
