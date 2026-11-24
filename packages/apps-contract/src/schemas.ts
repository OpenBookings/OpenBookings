import { z } from "zod";

export const APPS_API_VERSION = "v1";
export const MAX_ARI_CHANGES = 5000; // per request
export const MAX_ARI_SPAN_DAYS = 750; // per change range, inclusive

/** YYYY-MM-DD calendar date. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "not a real calendar date");
export type IsoDate = z.infer<typeof IsoDateSchema>;

function dayNumber(s: string): number {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

const cents = z.number().int();
const nonNegCents = cents.nonnegative();
const count = z.number().int().nonnegative();

const checkRange = (r: { from: string; to: string }, ctx: z.RefinementCtx) => {
  const days = dayNumber(r.to) - dayNumber(r.from) + 1;
  if (days < 1) ctx.addIssue({ code: "custom", message: "`to` must not be before `from`", path: ["to"] });
  else if (days > MAX_ARI_SPAN_DAYS)
    ctx.addIssue({ code: "custom", message: `range spans ${days} days, max ${MAX_ARI_SPAN_DAYS}`, path: ["to"] });
};

export const AppRatePlanSchema = z.object({
  code: z.string(),
  name: z.string(),
  isRefundable: z.boolean(),
  includesBreakfast: z.boolean(),
  includesLunch: z.boolean(),
  includesDinner: z.boolean(),
});
export type AppRatePlan = z.infer<typeof AppRatePlanSchema>;

export const AppRoomSchema = z.object({
  code: z.string(),
  name: z.string(),
  baseOccupancy: z.number().int(),
  maxAdults: z.number().int(),
  maxChildren: z.number().int(),
  ratePlans: z.array(AppRatePlanSchema),
});
export type AppRoom = z.infer<typeof AppRoomSchema>;

export const AppStructureSchema = z.object({
  propertyCode: z.string(),
  propertyName: z.string(),
  timezone: z.string(),
  rooms: z.array(AppRoomSchema),
});
export type AppStructure = z.infer<typeof AppStructureSchema>;

export const InventoryChangeSchema = z
  .object({ roomCode: z.string(), from: IsoDateSchema, to: IsoDateSchema, unitsLeft: count })
  .superRefine(checkRange);
export type InventoryChange = z.infer<typeof InventoryChangeSchema>;

export const RateChangeSchema = z
  .object({
    ratePlanCode: z.string(),
    from: IsoDateSchema,
    to: IsoDateSchema,
    priceCents: nonNegCents,
    extraAdultCents: nonNegCents.nullable(),
    extraChildCents: nonNegCents.nullable(),
  })
  .superRefine(checkRange);
export type RateChange = z.infer<typeof RateChangeSchema>;

const stay = z.number().int().positive().nullable().optional();

/** Patch semantics: an absent field leaves the stored value untouched; null clears a stay limit. */
export const RestrictionChangeSchema = z
  .object({
    ratePlanCode: z.string(),
    from: IsoDateSchema,
    to: IsoDateSchema,
    closed: z.boolean().optional(),
    closedToArrival: z.boolean().optional(),
    closedToDeparture: z.boolean().optional(),
    minStayArrival: stay,
    maxStayArrival: stay,
    minStayThrough: stay,
    maxStayThrough: stay,
  })
  .superRefine(checkRange);
export type RestrictionChange = z.infer<typeof RestrictionChangeSchema>;

export const AriBatchSchema = z
  .object({
    inventory: z.array(InventoryChangeSchema),
    rates: z.array(RateChangeSchema),
    restrictions: z.array(RestrictionChangeSchema),
  })
  .refine((b) => b.inventory.length + b.rates.length + b.restrictions.length <= MAX_ARI_CHANGES, {
    message: `at most ${MAX_ARI_CHANGES} changes per request`,
  });
export type AriBatch = z.infer<typeof AriBatchSchema>;

export const AriResultSchema = z.union([
  z.object({ ok: z.literal(true), nights: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), error: z.string(), unknownCodes: z.array(z.string()) }),
]);
export type AriResult = z.infer<typeof AriResultSchema>;

export const AppNameSchema = z.object({ givenName: z.string(), surname: z.string() });
export type AppName = z.infer<typeof AppNameSchema>;

export const AppBookingRoomSchema = z.object({
  reservationId: z.string(),
  roomCode: z.string(),
  ratePlanCode: z.string(),
  checkIn: IsoDateSchema,
  checkOut: IsoDateSchema,
  adults: count,
  children: count,
  infants: count,
  cots: count,
  extraBeds: count,
  cancelled: z.boolean(),
  nights: z.array(z.object({ date: IsoDateSchema, priceCents: cents })),
  touristTaxCents: cents,
  payAtPropertyCents: cents,
});
export type AppBookingRoom = z.infer<typeof AppBookingRoomSchema>;

export const AppBookingSchema = z.object({
  bookingId: z.string(),
  reference: z.string(),
  version: z.number().int(),
  cancelled: z.boolean(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  checkIn: IsoDateSchema,
  checkOut: IsoDateSchema,
  booker: AppNameSchema,
  rooms: z.array(AppBookingRoomSchema),
  roomsTotalCents: cents,
  touristTaxCents: cents,
  commissionCents: cents,
});
export type AppBooking = z.infer<typeof AppBookingSchema>;

export const BookingChangesPageSchema = z.object({
  bookings: z.array(AppBookingSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
});
export type BookingChangesPage = z.infer<typeof BookingChangesPageSchema>;

export const DeliveryStatusSchema = z.enum(["delivered", "retrying", "needs_attention"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const DeliveryReportSchema = z.object({
  status: DeliveryStatusSchema,
  acknowledgedAt: z.string().nullable(),
  detail: z.string().nullable(),
});
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

export const InstallationRegistrationSchema = z.object({
  installationId: z.string(),
  propertyCode: z.string(),
  propertyName: z.string(),
  apiKey: z.string(),
  coreBaseUrl: z.string(),
});
export type InstallationRegistration = z.infer<typeof InstallationRegistrationSchema>;
