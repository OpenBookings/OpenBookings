import { captureServerEvent } from "@openbookings/analytics/server";
import { trackingConfig, type TrackingConfig } from "./config";
import { isConsented, type TrackDeps } from "./track";
import { openToken, type TrackingToken } from "./token";

/** 1x1 transparent GIF (42 bytes once decoded). */
export const PIXEL_GIF: Uint8Array = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
);

const DEFAULT_DESTINATION = "https://openbookings.co";

type HandleDeps = Pick<TrackDeps, "config" | "consentAccepted" | "capture" | "now">;

/** Coarse mail-client hint only; the user-agent string itself is never forwarded. */
export function clientProxy(userAgent: string | null): "google" | "apple_suspected" | null {
  if (!userAgent) return null;
  if (userAgent.includes("GoogleImageProxy")) return "google";
  if (userAgent === "Mozilla/5.0") return "apple_suspected";
  return null;
}

/** The token's destination when it is one of our own hosts, else the web home. */
export function clickDestination(
  token: string,
  config: TrackingConfig | null,
): { destination: string; payload: TrackingToken | null } {
  const home = config?.baseUrl ?? DEFAULT_DESTINATION;
  const payload = config ? openToken(token, config.key) : null;
  if (!config || !payload?.d) return { destination: home, payload };
  try {
    const url = new URL(payload.d);
    const ok = (url.protocol === "https:" || url.protocol === "http:") && config.ownHosts.includes(url.host);
    return { destination: ok ? payload.d : home, payload };
  } catch {
    return { destination: home, payload };
  }
}

async function captureEngagement(
  event: "email_opened" | "email_clicked",
  payload: TrackingToken,
  userAgent: string | null,
  config: TrackingConfig,
  deps: HandleDeps,
): Promise<void> {
  try {
    const anonymous = payload.u === null;
    if (!anonymous) {
      const consented = deps.consentAccepted ?? ((id: string) => isConsented(id, config));
      if (!(await consented(payload.u as string))) return;
    }
    const nowSeconds = Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
    const properties: Record<string, string | number | boolean | null> = {
      email_kind: payload.k,
      send_id: payload.s,
      seconds_after_send: nowSeconds - payload.t,
      client_proxy: clientProxy(userAgent),
    };
    if (event === "email_clicked") properties.link = payload.l ?? null;
    const capture = deps.capture ?? captureServerEvent;
    await capture({
      distinctId: payload.u ?? payload.s,
      event,
      properties,
      ...(anonymous ? { anonymous: true } : {}),
    });
  } catch (error) {
    console.error(`[email-tracking] ${event} capture failed`, error);
  }
}

export async function handleOpen(token: string, userAgent: string | null, deps: HandleDeps = {}): Promise<void> {
  try {
    const config = deps.config === undefined ? trackingConfig() : deps.config;
    if (!config) return;
    const payload = openToken(token, config.key);
    if (!payload) return;
    await captureEngagement("email_opened", payload, userAgent, config, deps);
  } catch (error) {
    console.error("[email-tracking] open handling failed", error);
  }
}

export async function handleClick(
  payload: TrackingToken | null,
  userAgent: string | null,
  deps: HandleDeps = {},
): Promise<void> {
  try {
    if (!payload) return;
    const config = deps.config === undefined ? trackingConfig() : deps.config;
    if (!config) return;
    await captureEngagement("email_clicked", payload, userAgent, config, deps);
  } catch (error) {
    console.error("[email-tracking] click handling failed", error);
  }
}
