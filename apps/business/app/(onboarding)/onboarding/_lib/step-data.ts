import { z } from "zod";

/**
 * What the browser may write into `host_onboarding.step_data` through
 * `saveStepData`.
 *
 * `saveStepData` is a server action, so its arguments are whatever the caller
 * posts, whatever the TypeScript signature says. The step name becomes a
 * top-level key of the merged JSON, and that JSON also holds values the
 * server owns: `stripe_account_id` (read by promotion.ts as the property's
 * payout account) and the signed legal records. An unchecked step name would
 * let a host overwrite either. So only the two steps the onboarding forms
 * actually save are accepted, each parsed to exactly the fields it has;
 * everything else is written by a dedicated server-side action that computes
 * its own value.
 */

const text = (max: number) => z.string().max(max);

const coreInfoTextSchema = z.object({
  displayName: text(200),
  tagline: text(300),
  description: text(10_000),
  houseRulesText: text(10_000),
});

const coreInfoLocationSchema = z.object({
  streetAddress: text(200),
  city: text(120),
  country: text(100),
  postalCode: text(20),
  // [longitude, latitude]
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
});

const CLIENT_STEP_SCHEMAS = {
  "core-info-text": coreInfoTextSchema,
  "core-info-location": coreInfoLocationSchema,
} as const;

export type ClientStep = keyof typeof CLIENT_STEP_SCHEMAS;

export function isClientStep(step: unknown): step is ClientStep {
  return typeof step === "string" && Object.hasOwn(CLIENT_STEP_SCHEMAS, step);
}

/**
 * The cleaned payload for `step`, or null when the step is not one the browser
 * may save or the data does not fit. Unknown fields are dropped, not stored.
 */
export function parseClientStepData(step: unknown, data: unknown): unknown | null {
  if (!isClientStep(step)) return null;
  const parsed = CLIENT_STEP_SCHEMAS[step].safeParse(data);
  return parsed.success ? parsed.data : null;
}
