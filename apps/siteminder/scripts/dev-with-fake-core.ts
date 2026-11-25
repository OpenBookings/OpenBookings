/**
 * Runs the SiteMinder app on :3004 against a fake core, for the replay tool and the Postman collection.
 *
 *   SITEMINDER_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/siteminder bun run scripts/dev-with-fake-core.ts
 *
 * Applies the app's migrations to that database and registers one installation (hotel code FAKE-HOTEL) pointing
 * at the fake core. Refuses any database that is not on localhost: never point it at a shared database.
 */
import { applyMigrations } from "../src/db/migrate";
import { assertLocalDatabase } from "./local-db";

// Applies migrations and writes rows: a local throwaway Postgres only (see README, Testing locally).
assertLocalDatabase("SITEMINDER_DATABASE_URL", process.env.SITEMINDER_DATABASE_URL);

const hotel = process.env.FAKE_CORE_HOTEL ?? "FAKE-HOTEL";
const defaults: Record<string, string> = {
  SITEMINDER_INBOUND_USERNAME: "replay-user",
  SITEMINDER_INBOUND_PASSWORD: "replay-pass",
  SITEMINDER_RESERVATION_URL: "http://localhost:9/unused",
  SITEMINDER_RESERVATION_USERNAME: "unused",
  SITEMINDER_RESERVATION_PASSWORD: "unused",
  SITEMINDER_REQUESTOR_ID: "unused",
  APP_SITEMINDER_REGISTRATION_SECRET: "local-registration-secret",
  SITEMINDER_TICK_SECRET: "local-tick-secret",
  SITEMINDER_RUN_MODE: "always-on",
};
for (const [name, value] of Object.entries(defaults)) process.env[name] ||= value;

// Imported after the env is set; the app reads its env lazily but the pool is opened on first use.
const { getPool } = await import("../src/db/pool");
const { upsertInstallation } = await import("../src/installations");
const { createApp } = await import("../src/index");
const { startRunMode } = await import("../src/run-mode");
const { defaultTickDeps } = await import("../src/tick");
const { startFakeCore } = await import("../src/testing/fake-core");
const { env } = await import("../src/env");

const core = startFakeCore({ port: Number(process.env.FAKE_CORE_PORT ?? 4010), propertyCode: hotel });
const db = getPool();
await applyMigrations(db);
await upsertInstallation(db, {
  installationId: "00000000-0000-4000-8000-0000000000f4",
  propertyCode: hotel,
  propertyName: "Fake Core Hotel",
  apiKey: "fake-core-key",
  coreBaseUrl: core.url,
});

const port = Number(process.env.PORT ?? 3004);
Bun.serve({ port, fetch: createApp().fetch });
startRunMode(defaultTickDeps(), env.runMode, 5);
console.log(`siteminder on http://localhost:${port}/soap (user ${env.soapUsername}), fake core ${core.url}, hotel ${hotel}`);
