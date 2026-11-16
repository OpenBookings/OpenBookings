import { randomUUID } from "node:crypto";
import { captureServerEvent } from "@openbookings/analytics/server";
import { trackingConfig } from "./config";
import { isConsented, type TrackDeps } from "./track";

export type OutcomeEvent =
  | "review_submitted"
  | "team_invitation_accepted"
  | "stay_marked_arrived"
  | "support_thread_viewed";

/** Outcome of an emailed action. Consent-gated for users; never throws. */
export async function captureOutcome(
  event: OutcomeEvent,
  who: { userId: string } | "anonymous",
  properties: Record<string, string> = {},
  deps: Pick<TrackDeps, "config" | "consentAccepted" | "capture" | "newId"> = {},
): Promise<void> {
  try {
    const config = deps.config === undefined ? trackingConfig() : deps.config;
    if (!config) return;
    const capture = deps.capture ?? captureServerEvent;

    if (who === "anonymous") {
      await capture({ distinctId: (deps.newId ?? randomUUID)(), event, properties, anonymous: true });
      return;
    }
    const consented = deps.consentAccepted ?? ((id: string) => isConsented(id, config));
    if (!(await consented(who.userId))) return;
    await capture({ distinctId: who.userId, event, properties });
  } catch (error) {
    console.error("[email-tracking] outcome capture failed", error);
  }
}
