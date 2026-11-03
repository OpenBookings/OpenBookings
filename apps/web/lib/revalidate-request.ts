import { timingSafeEqual } from "node:crypto";

/**
 * The paths another app (business) may ask us to refresh. Only listing pages:
 * nothing else on this site is cached per path, and accepting arbitrary paths
 * would let a leaked secret churn the whole cache.
 */
const PROPERTY_PATH = /^\/p\/[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_PATHS = 20;

/** Same timing-safe bearer check as the cron routes in @openbookings/messaging. */
export function bearerAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const presented = Buffer.from(header ?? "");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** The listing paths in a `{ paths: [...] }` body, or null if any entry is not one. */
export function parseRevalidatePaths(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const paths = (body as { paths?: unknown }).paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) return null;
  if (!paths.every((p): p is string => typeof p === "string" && PROPERTY_PATH.test(p))) return null;
  return [...new Set(paths)];
}
