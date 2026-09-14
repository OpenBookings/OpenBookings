import { z } from "zod";

/** 24-hour "HH:MM". Postgres `time` accepts more, but the editor renders a time input. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = "Use a 24-hour time like 15:00.";

/** Payment methods the listing page has artwork for. */
export const PAYMENT_METHODS = [
  "visa",
  "mastercard",
  "amex",
  "wero",
  "applepay",
  "cash",
] as const;

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required.`);

/** An optional time input: "" means the host left it blank, and blank is NULL. */
const optionalTime = z
  .union([z.literal(""), z.string().regex(TIME, TIME_MESSAGE)])
  .transform((v) => (v === "" ? null : v));

/**
 * An optional money input. Whole currency units only — the column is bigint and
 * every consumer treats it as an integer. "" is NULL, not 0: "no extra-bed fee
 * stated" and "extra beds are free" are different claims to a guest.
 */
const optionalMoney = z
  .union([
    z.literal(""),
    z.coerce
      .number({ error: "Enter an amount in whole euros." })
      .int("Enter a whole amount, without cents.")
      .min(0, "An amount cannot be negative."),
  ])
  .transform((v) => (v === "" ? null : v));

/** An HTML checkbox posts "on" when ticked and nothing at all when not. */
const checkbox = z
  .unknown()
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
    freeCancellationDays: z.coerce
      .number({ error: "Enter a number of days." })
      .int("Enter a whole number of days.")
      .min(0, "A cancellation window cannot be negative.")
      .max(365, "Enter a window of a year or less."),
    prepaymentRequired: checkbox,
    childrenWelcome: checkbox,
    minCheckInAge: z.coerce
      .number({ error: "Enter a minimum age." })
      .int("Enter a whole number.")
      .min(1, "Enter a plausible minimum age.")
      .max(99, "Enter a plausible minimum age."),
    cotPolicy: z.enum(["free", "paid", "unavailable"]).nullable().catch(null),
    cotFee: optionalMoney,
    extraBedFee: optionalMoney,
    petsAllowed: checkbox,
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Pick at least one payment method."),
    finePrint: textRows("Add at least one line of fine print."),
  })
  .refine((v) => v.cotPolicy !== "paid" || v.cotFee !== null, {
    path: ["cotFee"],
    message: "State what you charge for a cot, or change the cot policy.",
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
  timezone: requiredText("Timezone"),
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
})
.refine((v) => !(v.lat === 0 && v.lon === 0), {
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
