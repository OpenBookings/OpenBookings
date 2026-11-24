import { createHash, timingSafeEqual } from "node:crypto";
import { InstallationRegistrationSchema } from "@openbookings/apps-contract";
import { Hono, type Context, type Next } from "hono";
import { getPool } from "./db/pool";
import type { Queryable } from "./db/migrate";
import { type DoorbellDeps, defaultDoorbellDeps, handleDoorbell } from "./doorbell";
import { assertRequiredEnv, env } from "./env";
import { inboxHealth } from "./inbox";
import { removeInstallation, upsertInstallation } from "./installations";
import { startRunMode } from "./run-mode";
import { type SoapDeps, defaultSoapDeps, handleSoap } from "./soap/route";
import { DEFAULT_BUDGET_MS, type TickDeps, defaultTickDeps, tick } from "./tick";

// Only when this file is the entrypoint — importing it (tests) must not
// require the production env set.
if (import.meta.main) assertRequiredEnv();

/** `POST /tick` (the outside scheduler in scale-to-zero) starts new work for this long. */
const TICK_ENDPOINT_BUDGET_MS = DEFAULT_BUDGET_MS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time bearer check: both sides hashed, so length never leaks. */
function hasBearer(header: string | undefined, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(sha256(presented), sha256(secret));
}

export function createApp(
  getDb: () => Queryable = getPool,
  soapDeps: SoapDeps = defaultSoapDeps,
  tickDeps: () => TickDeps = defaultTickDeps,
  doorbellDeps: DoorbellDeps = defaultDoorbellDeps,
) {
  const app = new Hono();

  // Queue depth and the oldest message's age, as SiteMinder asks us to monitor.
  app.get("/health", async (c) => {
    try {
      return c.json({ ok: true, ...(await inboxHealth(getDb(), soapDeps.now())) });
    } catch (e) {
      console.error("[siteminder] health check could not read the inbox", { error: e instanceof Error ? e.message : String(e) });
      return c.json({ ok: false, error: "database unavailable" }, 503);
    }
  });

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

  app.post("/doorbell", (c) => handleDoorbell(c, getDb, tickDeps, doorbellDeps));

  app.post("/tick", async (c) => {
    if (!hasBearer(c.req.header("authorization"), env.tickSecret)) return c.json({ error: "unauthorized" }, 401);
    return c.json(await tick(tickDeps(), { budgetMs: TICK_ENDPOINT_BUDGET_MS }));
  });

  return app;
}

if (import.meta.main) startRunMode(defaultTickDeps(), env.runMode, env.pollSeconds);

export default createApp();
