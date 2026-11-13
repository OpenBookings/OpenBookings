import { z } from "zod";

import { hasPin } from "./geo";
import { EU_TIMEZONES } from "./timezones";

/** 24-hour "HH:MM". Postgres `time` accepts more, but the editor renders a time input. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = "Use a 24-hour time like 15:00.";

/**
 * Codes a host may select. The display name, logo and tooltip for each live in
 * the `payment_methods` table — this list is only the accept-set for the form,
 * so a new code needs a catalogue row *and* an entry here.
 *
 * No cash: every payment goes through the platform (0021_platform_payments_only).
 */
export const PAYMENT_METHODS = [
  "visa",
  "mastercard",
  "amex",
  "wero",
  "applepay",
] as const;

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required.`);

/** An optional time input: "" means the host left it blank, and blank is NULL. */
const optionalTime = z
  .union([z.literal(""), z.string().regex(TIME, TIME_MESSAGE)])
  .transform((v) => (v === "" ? null : v));

/**
 * An HTML checkbox posts "on" when ticked and nothing at all when not — so a
 * missing key is a real answer (unticked), not a malformed submission.
 */
const checkbox = z
  .unknown()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === true);

/** Repeatable text rows: blank rows are the host's scratch space, not content. */
const textRows = (message: string) =>
  z
    .array(z.string())
    .transform((rows) => rows.map((r) => r.trim()).filter((r) => r.length > 0))
    .refine((rows) => rows.length > 0, { message });

export const identitySchema = z.object({
  name: requiredText("Property name").max(255, "Keep the name under 255 characters."),
  subtitle: requiredText("Tagline").max(255, "Keep the tagline under 255 characters."),
});

export const overviewSchema = z.object({
  overviewHeadline: requiredText("Headline").max(120, "Keep the headline under 120 characters."),
  overviewDescription: z
    .string()
    .trim()
    .min(120, "Write at least 120 characters — this is the paragraph guests read first."),
  ctaHeadline: requiredText("Closing headline").max(120, "Keep it under 120 characters."),
  ctaBody: requiredText("Closing message"),
  amenityIds: z.array(z.uuid()).min(1, "Pick at least one amenity."),
});

export const policiesSchema = z
  .object({
    checkInTime: z.string().regex(TIME, TIME_MESSAGE),
    checkInUntil: optionalTime,
    checkOutTime: z.string().regex(TIME, TIME_MESSAGE),
    reception24h: checkbox,
    // Annex B base tier for every refundable rate. Non-refundable is chosen per rate.
    cancellationTier: z.enum(["flex", "standard"], { error: "Pick a cancellation policy." }),
    childrenWelcome: checkbox,
    minCheckInAge: z.coerce
      .number({ error: "Enter a minimum age." })
      .int("Enter a whole number.")
      .min(1, "Enter a plausible minimum age.")
      .max(99, "Enter a plausible minimum age."),
    petsAllowed: checkbox,
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Pick at least one payment method."),
    finePrint: textRows("Add at least one line of fine print."),
  });

export const locationSchema = z.object({
  locationAbout: requiredText("About"),
  addressLine1: requiredText("Address").max(255, "Keep it under 255 characters."),
  addressLine2: z
    .string()
    .trim()
    .max(255, "Keep it under 255 characters.")
    .transform((v) => (v === "" ? null : v)),
  postalCode: requiredText("Postal code").max(20, "Keep it under 20 characters."),
  city: requiredText("City").max(100, "Keep it under 100 characters."),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Pick a country."),
  timezone: requiredText("Timezone").refine((v) => EU_TIMEZONES.has(v), "Pick a timezone from the list."),
  lat: z
    .string()
    .refine((v) => v.trim() !== "", "Drop a pin on the map.")
    .transform((v) => Number(v))
    .refine((v) => v >= -90 && v <= 90, "That latitude is off the map."),
  lon: z
    .string()
    .refine((v) => v.trim() !== "", "Drop a pin on the map.")
    .transform((v) => Number(v))
    .refine((v) => v >= -180 && v <= 180, "That longitude is off the map."),
  pinSetManually: checkbox,
})
// Shares hasPin with the checklist and the editor's map, so "the origin means
// no pin" is stated once. The editor now renders its empty state from the same
// rule, which is what stops this refusal arriving with no pin on screen to move.
.refine((v) => hasPin(v.lat, v.lon), {
  path: ["lat"],
  message: "Drop a pin on the map.",
});

export const legalSchema = z.object({
  legalCompanyName: requiredText("Legal company name").max(255, "Keep it under 255 characters."),
  contactEmail: z.email("Enter a valid email address."),
  contactPhone: requiredText("Contact phone").max(50, "Keep it under 50 characters."),
  companyRegistration: requiredText("Company registration").max(100, "Keep it under 100 characters."),
  vatNumber: requiredText("VAT number").max(100, "Keep it under 100 characters."),
});

// There is deliberately no `photosSchema`. Photos are not form fields — an
// upload commits as it completes (Task 11), so there is no submitted payload to
// validate. Whether the Photos section is finished is a completeness question,
// and completion.ts already answers it.
