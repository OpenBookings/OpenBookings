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

function createPool(): Pool | null {
  if (!connectionString) return null;
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
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

/** Get the shared Drizzle client. Throws if DATABASE_URL is not set. */
export function getDb() {
  if (globalThis.__drizzleDb) return globalThis.__drizzleDb;
  const instance = drizzle({ client: getPool() });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__drizzleDb = instance;
  }
  return instance;
}
