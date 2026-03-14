import { Pool } from "pg";

const connectionString =
  process.env.NEXT_PUBLIC_DATABASE_URL;

const pool =
  connectionString ?
    new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

/** Get the shared Postgres pool. Throws if DATABASE_URL/POSTGRES_URL is not set. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error(
      "Postgres not configured: set DATABASE_URL or POSTGRES_URL"
    );
  }
  return pool;
}

/** Run a parameterized query and return rows. Uses the shared pool. */
export async function query<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const client = getPool();
  const result = await client.query(text, values);
  return (result.rows ?? []) as T[];
}

/** Run a query and return the single first row, or null. */
export async function queryOne<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}
