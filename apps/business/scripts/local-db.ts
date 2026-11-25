/**
 * Whether a Postgres connection string points at this machine, judged the way the `pg` driver reads it
 * (pg-connection-string): a `host` query parameter wins over the URL's host, `/…` and `socket:` strings are Unix
 * sockets, and a URL without a host falls back to PGHOST. Local scripts that apply migrations or write rows call
 * `assertLocalDatabase` first, so a local run never touches a shared or hosted database.
 *
 * Mirrors apps/siteminder/scripts/local-db.ts; keep the two in step. Not shared: the SiteMinder app may not import
 * core code, and the pruned business image (`turbo prune @openbookings/business`) does not contain apps/siteminder.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Query parameters that can send the driver (or libpq) somewhere other than the URL's host. */
const HOST_PARAMETERS = new Set(["host", "hostaddr", "service"]);

/** Null when `raw` is a TCP connection string to localhost; otherwise why not, without the secret parts. */
export function localDatabaseProblem(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return "is not set";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not a postgres:// URL";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return `uses ${url.protocol}, not postgres:`;
  for (const key of url.searchParams.keys()) {
    if (HOST_PARAMETERS.has(key.toLowerCase())) return `sets ?${key}=, which can override the host`;
  }
  let host: string;
  try {
    host = decodeURIComponent(url.hostname).replace(/^\[(.+)\]$/, "$1");
  } catch {
    return "has a host that cannot be read";
  }
  if (!host) return "names no host (the driver would fall back to PGHOST)";
  if (!LOCAL_HOSTS.has(host.toLowerCase())) return `points at ${host}, not this machine`;
  return null;
}

/** The trimmed connection string, or a throw naming the variable and the problem. */
export function assertLocalDatabase(name: string, raw: string | undefined): string {
  const problem = localDatabaseProblem(raw);
  if (problem) {
    throw new Error(`${name} ${problem}. This script writes rows and only runs against a local throwaway database.`);
  }
  return raw!.trim();
}
