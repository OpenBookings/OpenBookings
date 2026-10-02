/**
 * The wire shape of one consent event, shared by the browser outbox and the
 * route that stores it. Validation lives in consent-schema.ts (server only).
 */
export type ConsentEventType = "granted" | "denied" | "withdrawn" | "linked";

export type ConsentEvent = {
  /** Random id minted on the device; identifies its consent record, not a person. */
  consentId: string;
  eventType: ConsentEventType;
  categories: { analytics: boolean };
  bannerVersion: string;
  /** Minted per event, so a retried request cannot be recorded twice. */
  idempotencyKey: string;
};

// Bump this when cookie policy changes to force re-consent. Kept out of the
// 'use client' module so a server layout can read the value, not a reference.
export const CONSENT_VERSION = process.env.NEXT_PUBLIC_COOKIE_VERSION ?? "1";

/**
 * What a consent event records as the wording the visitor was shown: the
 * banner version plus, where the app has one, the policy document it links
 * to — e.g. `1.1+privacy@2026-10-03/en`.
 */
export function consentBannerVersion(documentId?: string): string {
  return documentId ? `${CONSENT_VERSION}+${documentId}` : CONSENT_VERSION;
}

/**
 * Which event a decision is. Declining after having accepted is recorded as a
 * withdrawal, not a plain denial: the two mean different things as evidence.
 */
export function consentEventType(
  next: "accepted" | "declined",
  previous: "accepted" | "declined" | null,
): Exclude<ConsentEventType, "linked"> {
  if (next === "accepted") return "granted";
  return previous === "accepted" ? "withdrawn" : "denied";
}
