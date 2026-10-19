/**
 * Dev-only request tracer, same format as apps/support-bot's. Silent in
 * production. Values are passed as separate arguments so remote input can't
 * act as a format string.
 */
const enabled = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

export function trace(scope: string, event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  const suffix = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  console.log("[%s] %s %s%s", ts, scope.padEnd(8), event, suffix);
}
