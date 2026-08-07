/**
 * Dev-only step tracer — one readable line per pipeline step, so running
 * `bun run dev` and firing a webhook shows the whole request flow (webhook →
 * task → agent loop → tool calls → Chatwoot post) in order in the terminal.
 * No-ops when NODE_ENV=production so this never becomes a Cloud Run logging
 * concern.
 */
const enabled = process.env.NODE_ENV !== "production";

export function trace(scope: string, event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  const suffix = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${ts}] ${scope.padEnd(8)} ${event}${suffix}`);
}
