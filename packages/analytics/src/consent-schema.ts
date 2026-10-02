import { z } from "zod";
import type { ConsentEvent } from "./consent-events";

/**
 * Server-side validation of a consent event. Kept apart from consent-events.ts
 * so the browser bundle, which only needs the types, does not carry zod.
 *
 * Strict at every level: an unknown key is a rejected request, not an ignored
 * one. That is what stops a caller from naming its own `userId` or attaching
 * anything (an IP, a note) that this log is specifically meant not to hold.
 */
export const consentEventSchema: z.ZodType<ConsentEvent> = z.strictObject({
  consentId: z.uuid(),
  eventType: z.enum(["granted", "denied", "withdrawn", "linked"]),
  categories: z.strictObject({ analytics: z.boolean() }),
  bannerVersion: z.string().min(1).max(100),
  idempotencyKey: z.uuid(),
});
