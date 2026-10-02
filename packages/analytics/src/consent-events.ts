import { z } from "zod";

/**
 * The wire shape of one consent event, shared by the browser outbox and the
 * route that stores it.
 *
 * Strict at every level: an unknown key is a rejected request, not an ignored
 * one. That is what stops a caller from naming its own `userId` or attaching
 * anything (an IP, a note) that this log is specifically meant not to hold.
 */
export const consentEventSchema = z.strictObject({
  consentId: z.uuid(),
  eventType: z.enum(["granted", "denied", "withdrawn", "linked"]),
  categories: z.strictObject({ analytics: z.boolean() }),
  bannerVersion: z.string().min(1).max(100),
  idempotencyKey: z.uuid(),
});

export type ConsentEvent = z.infer<typeof consentEventSchema>;
export type ConsentEventType = ConsentEvent["eventType"];
