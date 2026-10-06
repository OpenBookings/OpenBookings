import { z } from "zod";
import {
  BED_TYPE_KEYS,
  LIMITS,
  MAX_ADVANCE_OPTIONS,
  MAX_FEATURED_AMENITIES,
  MIN_ADVANCE_OPTIONS,
  RATE_EXTRA_KEYS,
  ROOM_AMENITY_KEYS,
  type BedConfig,
} from "./constants";

/**
 * One schema per form, used twice: by the server action that saves it, and
 * (through LIMITS) by the form that renders it. FormData values arrive as
 * strings, so numbers are coerced here rather than trusted.
 */

/** An HTML checkbox or Radix switch posts "on" when ticked and nothing when not. */
const checkbox = z
  .unknown()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === true);

const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `Enter ${label}.` })
    .int(`Enter a whole number for ${label}.`)
    .min(min, `${capitalise(label)} must be at least ${min}.`)
    .max(max, `${capitalise(label)} can be at most ${max}.`);

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────
// Room sections
// ─────────────────────────────────────────────

export const identitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.roomName.min, `Give the room a name of at least ${LIMITS.roomName.min} characters.`)
    .max(LIMITS.roomName.max, `Keep the name under ${LIMITS.roomName.max} characters.`),
  description: z
    .string()
    .trim()
    .min(
      LIMITS.roomDescription.min,
      `Write at least ${LIMITS.roomDescription.min} characters — guests read this on the room card.`,
    )
    .max(
      LIMITS.roomDescription.max,
      `Keep the description under ${LIMITS.roomDescription.max} characters.`,
    ),
});

const bedsSchema = z
  .object(
    Object.fromEntries(
      BED_TYPE_KEYS.map((key) => [key, wholeNumber("a bed count", 0, LIMITS.bedsPerType.max)]),
    ) as Record<(typeof BED_TYPE_KEYS)[number], z.ZodCoercedNumber>,
  )
  .transform((beds): BedConfig => {
    // Store only the types the room has. `{}` and `{king: 0}` mean the same
    // thing, and one spelling keeps the jsonb comparable.
    const out: BedConfig = {};
    for (const key of BED_TYPE_KEYS) if (beds[key] > 0) out[key] = beds[key];
    return out;
  })
  .refine((beds) => Object.keys(beds).length > 0, "Add at least one bed.");

export const spaceSchema = z.object({
  sizeM2: z.coerce
    .number({ error: "Enter the room size in square metres." })
    .gt(0, "Enter the room size in square metres.")
    .max(LIMITS.sizeM2.max, "That size looks too large. Check the number.")
    // numeric(6,1): round to the one decimal the column keeps, so what the
    // host sees after saving is what they typed.
    .transform((v) => Math.round(v * 10) / 10),
  beds: bedsSchema,
  maxAdults: wholeNumber("maximum adults", LIMITS.adults.min, LIMITS.adults.max),
  maxChildren: wholeNumber("maximum children", LIMITS.children.min, LIMITS.children.max),
  units: wholeNumber("the number of units", LIMITS.units.min, LIMITS.units.max),
});

export const amenitiesSchema = z
  .object({
    amenityKeys: z
      .array(z.enum(ROOM_AMENITY_KEYS as [string, ...string[]]))
      .min(1, "Pick at least one amenity.")
      .transform((keys) => [...new Set(keys)]),
    featuredAmenityKeys: z
      .array(z.enum(ROOM_AMENITY_KEYS as [string, ...string[]]))
      .transform((keys) => [...new Set(keys)])
      .refine((keys) => keys.length <= MAX_FEATURED_AMENITIES, {
        message: `Feature up to ${MAX_FEATURED_AMENITIES} amenities.`,
      }),
  })
  .refine((v) => v.featuredAmenityKeys.every((k) => v.amenityKeys.includes(k)), {
    path: ["featuredAmenityKeys"],
    message: "Only selected amenities can be featured.",
  });

// ─────────────────────────────────────────────
// Rate plans
// ─────────────────────────────────────────────

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === "" ? null : v));

export const rateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.rateName.min, `Give the rate a name of at least ${LIMITS.rateName.min} characters.`)
    .max(LIMITS.rateName.max, `Keep the name under ${LIMITS.rateName.max} characters.`),
  description: optionalText(
    LIMITS.rateDescription.max,
    `Keep the description under ${LIMITS.rateDescription.max} characters.`,
  ),
  breakfast: checkbox,
  lunch: checkbox,
  dinner: checkbox,
  extras: z
    .array(z.enum(RATE_EXTRA_KEYS as [string, ...string[]]))
    .transform((keys) => [...new Set(keys)]),
  otherInclusion: optionalText(
    LIMITS.otherInclusion.max,
    `Keep this under ${LIMITS.otherInclusion.max} characters.`,
  ),
  minAdvanceDays: z.coerce
    .number()
    .refine((v) => (MIN_ADVANCE_OPTIONS as readonly number[]).includes(v), "Pick an option."),
  /** "none" is no limit. */
  maxAdvanceDays: z
    .string()
    .transform((v) => (v === "none" || v === "" ? null : Number(v)))
    .refine((v) => (MAX_ADVANCE_OPTIONS as readonly (number | null)[]).includes(v), "Pick an option."),
  // Plain text, length only. Nothing calculates refunds from it.
  cancellationText: optionalText(
    LIMITS.cancellation.max,
    `Keep the policy under ${LIMITS.cancellation.max} characters.`,
  ),
  active: checkbox,
});

export type RateInput = z.output<typeof rateSchema>;
