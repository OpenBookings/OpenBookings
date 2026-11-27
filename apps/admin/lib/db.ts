import { Pool, type PoolClient } from "pg";
import { getPool } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";

/**
 * The admin console's two database connections (migration 0054):
 *
 *   ADMIN_DATABASE_URL_READ   a login user acting as ob_admin_read: SELECT
 *                             only. Every page and data loader uses it.
 *   ADMIN_DATABASE_URL_WRITE  a login user acting as ob_admin_write: only
 *                             what the server actions change. Server actions
 *                             (files marked "use server") use it, nothing else.
 *
 * Neither set: both are the shared DATABASE_URL pool, for local development.
 * Only READ set: the console is read-only and every action refuses. Only
 * WRITE set is a mistake (reads would quietly go elsewhere) and throws.
 *
 * lib/db-usage.test.ts checks pages never reach the write connection and
 * nothing in the console uses the shared pool directly.
 */

type Env = Record<string, string | undefined>;

export type AdminDbConfig =
  /** DATABASE_URL for everything (local development). */
  | { kind: "shared" }
  /** The 0054 roles; `write` null = read-only. */
  | { kind: "roles"; read: string; write: string | null };

export function adminDbConfig(env: Env = process.env): AdminDbConfig {
  const read = env.ADMIN_DATABASE_URL_READ?.trim() || null;
  const write = env.ADMIN_DATABASE_URL_WRITE?.trim() || null;
  if (!read && !write) return { kind: "shared" };
  if (!read) {
    throw new Error(
      "ADMIN_DATABASE_URL_WRITE is set without ADMIN_DATABASE_URL_READ. Set both, or neither to use DATABASE_URL.",
    );
  }
  return { kind: "roles", read, write };
}

export class AdminReadOnlyError extends Error {
  constructor() {
    super("The console is read-only here: ADMIN_DATABASE_URL_WRITE is not set.");
    this.name = "AdminReadOnlyError";
  }
}

declare global {
  var __adminPools: Map<string, Pool> | undefined;
}

/** One pool per connection string, kept across dev reloads. */
function poolFor(connectionString: string, name: string): Pool {
  const pools = (globalThis.__adminPools ??= new Map<string, Pool>());
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 15_000,
      application_name: name,
    });
    // An idle client dropped by the server must not take the process down.
    pool.on("error", (err: Error) => console.error(`[admin] ${name}: idle client error`, err));
    pools.set(connectionString, pool);
  }
  return pool;
}

/** For pages and data loaders: SELECT only once the roles are configured. */
export function readPool(): Pool {
  const config = adminDbConfig();
  return config.kind === "shared" ? getPool() : poolFor(config.read, "openbookings-admin-read");
}

/** For server actions only. Throws AdminReadOnlyError when writes are off. */
export function writePool(): Pool {
  const config = adminDbConfig();
  if (config.kind === "shared") return getPool();
  if (!config.write) throw new AdminReadOnlyError();
  return poolFor(config.write, "openbookings-admin-write");
}

async function inTransaction<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** One BEGIN/COMMIT on the write connection. */
export function withWriteTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(writePool(), fn);
}

const lifecycleDbOn = (pool: Pool): LifecycleDb => ({
  query: (text, values) => pool.query(text, values),
  transaction: (fn) => inTransaction(pool, fn),
});

/**
 * The booking lifecycle's `db`. Always pass one: left out, the lifecycle uses
 * the shared DATABASE_URL pool, not the admin roles.
 */
export const readLifecycleDb = (): LifecycleDb => lifecycleDbOn(readPool());
export const writeLifecycleDb = (): LifecycleDb => lifecycleDbOn(writePool());

/** For the banner: which database each connection points at. */
export function adminDbLabel(host: (url: string | undefined) => string, env: Env = process.env): string {
  const config = adminDbConfig(env);
  if (config.kind === "shared") return host(env.DATABASE_URL);
  const read = host(config.read);
  if (!config.write) return `${read} (read-only)`;
  const write = host(config.write);
  return write === read ? `${read} (admin roles)` : `${read} (read) / ${write} (write)`;
}
