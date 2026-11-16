import { PostHog } from "posthog-node";

export function getPostHogClient(): PostHog {
  const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_KEY!;

  return new PostHog(posthogToken, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    flushAt: 1,
    flushInterval: 0,
  });
}

export type ServerEvent = {
  distinctId: string;
  event: string;
  properties: Record<string, string | number | boolean | null>;
  /** True for events with no person behind them: no profile is created. */
  anonymous?: boolean;
};

type CaptureClient = { captureImmediate(m: unknown): Promise<void> };

const DEFAULT_TIMEOUT_MS = 2000;

let cachedClient: CaptureClient | null | undefined;

function sharedClient(): CaptureClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  cachedClient = key && host ? new PostHog(key, { host, flushAt: 1, flushInterval: 0, disableGeoip: true }) : null;
  return cachedClient;
}

/**
 * Send one server-side event. Never throws and never waits longer than
 * `timeoutMs`: analytics must not break or delay the work it observes.
 * A no-op when PostHog is not configured.
 */
export async function captureServerEvent(
  e: ServerEvent,
  deps: { client?: CaptureClient; timeoutMs?: number } = {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = deps.client ?? sharedClient();
    if (!client) return;
    const properties = e.anonymous ? { ...e.properties, $process_person_profile: false } : e.properties;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    await Promise.race([client.captureImmediate({ distinctId: e.distinctId, event: e.event, properties }), timeout]);
  } catch (err) {
    console.error("[analytics] server capture failed", err instanceof Error ? err.message : err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
