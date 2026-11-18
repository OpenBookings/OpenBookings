import { captureServerEvent } from "@openbookings/analytics/server";
import { trackingConfig } from "./config";
import { isConsented, type TrackDeps } from "./track";

export type OutcomeEvent =
  | "review_submitted"
  | "team_invitation_accepted"
  | "stay_marked_arrived"
  | "support_thread_viewed";

/** Outcome of an emailed action. Captured only for a user with analytics consent; never throws. */
export async function captureOutcome(
  event: OutcomeEvent,
  who: { userId: string },
  properties: Record<string, string> = {},
  deps: Pick<TrackDeps, "config" | "consentAccepted" | "capture"> = {},
): Promise<void> {
  try {
    const config = deps.config === undefined ? trackingConfig() : deps.config;
    if (!config) return;
    const capture = deps.capture ?? captureServerEvent;
    const consented = deps.consentAccepted ?? ((id: string) => isConsented(id, config));
    if (!(await consented(who.userId))) return;
    await capture({ distinctId: who.userId, event, properties });
  } catch (error) {
    console.error("[email-tracking] outcome capture failed", error);
  }
}
