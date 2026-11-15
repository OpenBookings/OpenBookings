import { randomUUID } from "node:crypto";
import { captureServerEvent, type ServerEvent } from "@openbookings/analytics/server";
import { consentVersionOf, latestAnalyticsConsent, userIdByEmail as dbUserIdByEmail } from "@openbookings/db";
import { trackingConfig, type TrackingConfig } from "./config";
import { instrumentHtml } from "./instrument";
import { sealToken, type EmailKind } from "./token";

/** Kinds tracked without consent: recipients who may not have an account yet. */
export const ANONYMOUS_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(["team_invitation"]);

export type TrackDeps = {
  config?: TrackingConfig | null;
  userIdByEmail?: (email: string) => Promise<string | null>;
  consentAccepted?: (userId: string) => Promise<boolean>;
  capture?: (e: ServerEvent) => Promise<void>;
  newId?: () => string;
  now?: () => Date;
};

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

    const anonymous = ANONYMOUS_KINDS.has(input.kind);
    const lookup = deps.userIdByEmail ?? dbUserIdByEmail;
    const consented = deps.consentAccepted ?? ((id: string) => isConsented(id, config));

    let userId: string | null = null;
    if (anonymous) {
      userId = null;
    } else {
      userId = await lookup(input.to);
      if (!userId || !(await consented(userId))) return untouched;
    }

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
      distinctId: userId ?? sendId,
      event: "email_sent",
      properties: { email_kind: input.kind, send_id: sendId },
      ...(anonymous ? { anonymous: true } : {}),
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
