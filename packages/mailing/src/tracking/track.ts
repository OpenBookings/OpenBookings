import { randomUUID } from "node:crypto";
import { captureServerEvent, type ServerEvent } from "@openbookings/analytics/server";
import { consentVersionOf, latestAnalyticsConsent, userIdByEmail as dbUserIdByEmail } from "@openbookings/db";
import { trackingConfig, type TrackingConfig } from "./config";
import { instrumentHtml } from "./instrument";
import { sealToken, type EmailKind } from "./token";

export type TrackDeps = {
  config?: TrackingConfig | null;
  userIdByEmail?: (email: string) => Promise<string | null>;
  consentAccepted?: (userId: string) => Promise<boolean>;
  capture?: (e: ServerEvent) => Promise<void>;
  newId?: () => string;
  now?: () => Date;
  /** Budget for the pre-send user + consent lookups together; default `LOOKUP_TIMEOUT_MS`. */
  lookupTimeoutMs?: number;
};

/** The longest tracking may hold up a send; past it the untouched html goes out. */
export const LOOKUP_TIMEOUT_MS = 1500;

const TIMED_OUT = Symbol("timed out");

async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Latest unexpired analytics consent, given on a banner version at or above the configured one. */
export async function isConsented(
  userId: string,
  config: TrackingConfig,
  latest: typeof latestAnalyticsConsent = latestAnalyticsConsent,
): Promise<boolean> {
  const row = await latest(userId);
  if (!row || !row.analytics) return false;
  const version = consentVersionOf(row.bannerVersion);
  return version !== null && version >= config.consentVersion;
}

const noop = async () => {};

export async function trackMail(
  input: { kind: EmailKind; to: string; html: string },
  deps: TrackDeps = {},
): Promise<{ html: string; onSent: () => Promise<void> }> {
  const untouched = { html: input.html, onSent: noop };
  try {
    const config = deps.config === undefined ? trackingConfig() : deps.config;
    if (!config) return untouched;

    // Every kind needs a recipient with an account and analytics consent.
    // No kind is tracked without it, including team invitations: an invitee
    // who has no account yet, or never accepted analytics, gets the html untouched.
    const lookup = deps.userIdByEmail ?? dbUserIdByEmail;
    const consented = deps.consentAccepted ?? ((id: string) => isConsented(id, config));
    const consentedUser = async () => {
      const id = await lookup(input.to);
      return id && (await consented(id)) ? id : null;
    };
    const userId = await withinBudget(consentedUser(), deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS);
    if (userId === TIMED_OUT) {
      console.warn("[email-tracking] consent lookup timed out, sending untouched html");
      return untouched;
    }
    if (!userId) return untouched;

    const sendId = (deps.newId ?? randomUUID)();
    const sentAt = Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
    const base = { v: 1 as const, s: sendId, k: input.kind, u: userId, t: sentAt };
    const capture = deps.capture ?? captureServerEvent;

    const html = instrumentHtml(input.html, {
      pixelUrl: `${config.baseUrl}/e/o/${sealToken(base, config.key)}`,
      isOwnUrl: (url) => {
        try {
          return config.ownHosts.includes(new URL(url).host);
        } catch {
          return false;
        }
      },
      trackedUrl: (destination, linkName) =>
        `${config.baseUrl}/e/c/${sealToken({ ...base, l: linkName, d: destination }, config.key)}`,
    });

    const event: ServerEvent = {
      distinctId: userId,
      event: "email_sent",
      properties: { email_kind: input.kind, send_id: sendId },
    };
    return {
      html,
      onSent: async () => {
        try {
          await capture(event);
        } catch (error) {
          console.error("[email-tracking] email_sent capture failed", error);
        }
      },
    };
  } catch (error) {
    console.error("[email-tracking] tracking failed, sending untouched html", error);
    return untouched;
  }
}
