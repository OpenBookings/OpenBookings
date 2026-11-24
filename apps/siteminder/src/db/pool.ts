import { Pool } from "pg";
import { env } from "../env";

let pool: Pool | undefined;

/** The app's own database (schema `siteminder`), opened on first use. */
export function getPool(): Pool {
  pool ??= new Pool({ connectionString: env.databaseUrl, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}
