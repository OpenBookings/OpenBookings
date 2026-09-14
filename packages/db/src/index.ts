import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export { schema };
export * from "./schema";
export * from "./support";
export { sql } from "drizzle-orm";

const connectionType = process.env.ENV_TYPE;

const connectionString =
  connectionType === "dev"
    ? process.env.DEV_DATABASE_URL
    : process.env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | null | undefined;
}

/**
 * Per-process connection ceiling. Every Next.js server instance and every
 * support-bot container opens its own pool of this size, *plus* a second pool
 * of Better Auth's own (see packages/auth/src/server.ts), so the number
 * Postgres sees is `instances × (this + betterAuthMax)`. Tunable without a
 * code change so the ceiling can be lowered when instance count goes up.
 */
const POOL_MAX = Number(process.env.PGPOOL_MAX) || 10;

/**
 * Server-side caps, applied to every session the pool hands out.
 *
 * Without `statement_timeout` a single pathological query (an unbounded
 * ST_DWithin sweep, a lock wait) holds its connection until the client gives
 * up, and ten of them exhaust the pool for the whole instance.
 * `idle_in_transaction_session_timeout` covers the other direction: a request
 * that throws between BEGIN and COMMIT would otherwise pin a connection *and*
 * hold its locks indefinitely.
 */
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 15_000;
const IDLE_TX_TIMEOUT_MS = Number(process.env.PG_IDLE_TX_TIMEOUT_MS) || 15_000;

function createPool(): Pool | null {
  if (!connectionString) return null;

  // TLS is the connection string's business (Neon puts `sslmode=require` in
  // the URL it issues), but a production URL without it is a silent downgrade
  // to plaintext across the public internet, so say so loudly at boot.
  if (
    process.env.NODE_ENV === "production" &&
    !/[?&]sslmode=/.test(connectionString) &&
    !/[?&]ssl=true/.test(connectionString)
  ) {
    console.error(
      "[db] DATABASE_URL specifies no sslmode — the connection may be unencrypted. Append `?sslmode=require`.",
    );
  }

  const pool = new Pool({
    connectionString,
    max: POOL_MAX,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_TX_TIMEOUT_MS,
    // Shows up in pg_stat_activity, so a connection leak can be traced back
    // to the service that opened it rather than to "node".
    application_name: process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "openbookings",
  });

  // Mandatory, not defensive: `Pool` is an EventEmitter, and an idle client
  // dropped by the server (Neon scale-to-zero, a failover, an idle reap)
  // emits 'error'. An EventEmitter with no 'error' listener rethrows as an
  // uncaught exception, which takes the whole process down — a routine
  // backend blip becomes an outage. pg removes the broken client from the
  // pool itself; there is nothing to do here but record it.
  pool.on("error", (err) => {
    console.error("[db] idle client error (connection discarded):", err);
  });

  return pool;
}

const pool: Pool | null = globalThis.__pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

/** Get the shared Postgres pool. Throws if DATABASE_URL is not set. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error("Postgres not configured: set DATABASE_URL");
  }
  return pool;
}

/** Run a parameterized query and return rows. */
export async function query<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const client = getPool();
  const result = await client.query(text, values);
  return (result.rows ?? []) as T[];
}

/** Run a query and return the first row, or null. */
export async function queryOne<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

declare global {
  // eslint-disable-next-line no-var
  var __drizzleDb: ReturnType<typeof drizzle> | null | undefined;
}

/** Module-level cache, so production gets one instance too (see getDb). */
let drizzleDb: ReturnType<typeof drizzle> | null = null;

/**
 * Get the shared Drizzle client. Throws if DATABASE_URL is not set.
 *
 * Memoized in every environment. It used to be cached only outside
 * production, so each call on a live server built a fresh wrapper — same
 * underlying pool, so never a connection leak, but a per-request allocation
 * that bought nothing.
 */
export function getDb() {
  if (globalThis.__drizzleDb) return globalThis.__drizzleDb;
  if (drizzleDb) return drizzleDb;
  const instance = drizzle({ client: getPool() });
  drizzleDb = instance;
  if (process.env.NODE_ENV !== "production") {
    globalThis.__drizzleDb = instance;
  }
  return instance;
}
