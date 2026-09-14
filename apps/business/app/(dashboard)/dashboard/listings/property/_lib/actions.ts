"use server";

import { revalidatePath } from "next/cache";
import { userOwnsProperty } from "@openbookings/authz";
import { query, queryOne } from "@openbookings/db";
import type { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { canPublish } from "./completion";
import { loadEditorData } from "./query";
import {
  identitySchema,
  legalSchema,
  locationSchema,
  overviewSchema,
  policiesSchema,
} from "./schema";
import type { FormState } from "./types";

/**
 * Ownership is checked on every write, through the authz package rather than
 * inline SQL. A property id arriving in a FormData field is attacker-controlled
 * like any other form value.
 */
async function authorize(propertyId: string) {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthenticated");
  if (!propertyId || !(await userOwnsProperty(session, propertyId))) {
    // Deliberately not "forbidden": a host must not be able to probe which
    // property ids exist.
    throw new Error("Not found");
  }
  return session;
}

/**
 * The 1:1 content row may not exist yet — a property seeded before this feature,
 * or one whose promotion predates property_content. Every section that writes to
 * it calls this first, so no section has to care.
 */
async function ensureContentRow(propertyId: string) {
  await query(
    `INSERT INTO property_content (property_id) VALUES ($1)
     ON CONFLICT (property_id) DO NOTHING`,
    [propertyId],
  );
}

/**
 * The public listing page is server-rendered from these same rows, so a save
 * that only revalidates the dashboard leaves guests looking at stale HTML.
 */
async function revalidateBoth(propertyId: string) {
  const row = await queryOne<{ slug: string }>(
    `SELECT slug FROM properties WHERE id = $1`,
    [propertyId],
  );
  revalidatePath("/dashboard/listings/property");
  if (row) revalidatePath(`/p/${row.slug}`);
}

/** zod's flatten() shape is exactly what the Field components consume. */
function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return error.flatten().fieldErrors as Record<string, string[]>;
}

export async function saveIdentity(
  _prev: FormState<z.input<typeof identitySchema>>,
  formData: FormData,
): Promise<FormState<z.input<typeof identitySchema>>> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const values = {
    name: String(formData.get("name") ?? ""),
    subtitle: String(formData.get("subtitle") ?? ""),
  };

  await authorize(propertyId);

  const parsed = identitySchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };

  await query(
    `UPDATE properties SET name = $1, subtitle = $2, updated_at = NOW() WHERE id = $3`,
    [parsed.data.name, parsed.data.subtitle, propertyId],
  );

  await revalidateBoth(propertyId);
  return { values, errors: null, success: true };
}

export async function saveOverview(
  _prev: FormState<z.input<typeof overviewSchema>>,
  formData: FormData,
): Promise<FormState<z.input<typeof overviewSchema>>> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const values = {
    overviewHeadline: String(formData.get("overviewHeadline") ?? ""),
    overviewDescription: String(formData.get("overviewDescription") ?? ""),
    ctaHeadline: String(formData.get("ctaHeadline") ?? ""),
    ctaBody: String(formData.get("ctaBody") ?? ""),
    amenityIds: formData.getAll("amenityIds").map(String),
  };

  await authorize(propertyId);

  const parsed = overviewSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };

  await ensureContentRow(propertyId);
  await query(
    `UPDATE property_content
     SET overview_headline = $1, overview_description = $2,
         cta_headline = $3, cta_body = $4, updated_at = NOW()
     WHERE property_id = $5`,
    [
      parsed.data.overviewHeadline,
      parsed.data.overviewDescription,
      parsed.data.ctaHeadline,
      parsed.data.ctaBody,
      propertyId,
    ],
  );

  // Replace-all rather than diff: the set is small, the join table has no other
  // columns to preserve, and a diff would need a transaction to stay consistent.
  await query(`DELETE FROM property_amenities WHERE property_id = $1`, [propertyId]);
  await query(
    `INSERT INTO property_amenities (property_id, amenity_id)
     SELECT $1, UNNEST($2::uuid[])`,
    [propertyId, parsed.data.amenityIds],
  );

  await revalidateBoth(propertyId);
  return { values, errors: null, success: true };
}

export async function savePolicies(
  _prev: FormState<Record<string, unknown>>,
  formData: FormData,
): Promise<FormState<Record<string, unknown>>> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const values = {
    checkInTime: String(formData.get("checkInTime") ?? ""),
    checkInUntil: String(formData.get("checkInUntil") ?? ""),
    checkOutTime: String(formData.get("checkOutTime") ?? ""),
    reception24h: formData.get("reception24h"),
    freeCancellationDays: String(formData.get("freeCancellationDays") ?? ""),
    prepaymentRequired: formData.get("prepaymentRequired"),
    childrenWelcome: formData.get("childrenWelcome"),
    minCheckInAge: String(formData.get("minCheckInAge") ?? ""),
    cotPolicy: formData.get("cotPolicy") ? String(formData.get("cotPolicy")) : null,
    cotFee: String(formData.get("cotFee") ?? ""),
    extraBedFee: String(formData.get("extraBedFee") ?? ""),
    petsAllowed: formData.get("petsAllowed"),
    paymentMethods: formData.getAll("paymentMethods").map(String),
    finePrint: formData.getAll("finePrint").map(String),
  };

  await authorize(propertyId);

  const parsed = policiesSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  await query(
    `UPDATE properties
     SET check_in_time = $1::time, check_in_until = $2::time,
         check_out_time = $3::time, updated_at = NOW()
     WHERE id = $4`,
    [d.checkInTime, d.checkInUntil, d.checkOutTime, propertyId],
  );

  await ensureContentRow(propertyId);
  await query(
    `UPDATE property_content
     SET reception_24h = $1, free_cancellation_days = $2, prepayment_required = $3,
         children_welcome = $4, min_check_in_age = $5, cot_policy = $6::cot_policy,
         cot_fee = $7, extra_bed_fee = $8, pets_allowed = $9,
         payment_methods = $10::text[], fine_print = $11::text[], updated_at = NOW()
     WHERE property_id = $12`,
    [
      d.reception24h,
      d.freeCancellationDays,
      d.prepaymentRequired,
      d.childrenWelcome,
      d.minCheckInAge,
      d.cotPolicy,
      d.cotFee,
      d.extraBedFee,
      d.petsAllowed,
      d.paymentMethods,
      d.finePrint,
      propertyId,
    ],
  );

  await revalidateBoth(propertyId);
  return { values, errors: null, success: true };
}

export async function saveLocation(
  _prev: FormState<Record<string, unknown>>,
  formData: FormData,
): Promise<FormState<Record<string, unknown>>> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const values = {
    locationAbout: String(formData.get("locationAbout") ?? ""),
    addressLine1: String(formData.get("addressLine1") ?? ""),
    addressLine2: String(formData.get("addressLine2") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    city: String(formData.get("city") ?? ""),
    country: String(formData.get("country") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    lat: String(formData.get("lat") ?? ""),
    lon: String(formData.get("lon") ?? ""),
  };

  await authorize(propertyId);

  const parsed = locationSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  await query(
    `UPDATE properties
     SET address_line_1 = $1, address_line_2 = $2, postal_code = $3,
         city = $4, country = $5, timezone = $6,
         location = ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography,
         updated_at = NOW()
     WHERE id = $9`,
    [d.addressLine1, d.addressLine2, d.postalCode, d.city, d.country, d.timezone, d.lon, d.lat, propertyId],
  );

  await ensureContentRow(propertyId);
  await query(
    `UPDATE property_content SET location_about = $1, updated_at = NOW() WHERE property_id = $2`,
    [d.locationAbout, propertyId],
  );

  await revalidateBoth(propertyId);
  return { values, errors: null, success: true };
}

export async function saveLegal(
  _prev: FormState<z.input<typeof legalSchema>>,
  formData: FormData,
): Promise<FormState<z.input<typeof legalSchema>>> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const values = {
    legalCompanyName: String(formData.get("legalCompanyName") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    companyRegistration: String(formData.get("companyRegistration") ?? ""),
    vatNumber: String(formData.get("vatNumber") ?? ""),
  };

  await authorize(propertyId);

  const parsed = legalSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  await ensureContentRow(propertyId);
  await query(
    `UPDATE property_content
     SET legal_company_name = $1, contact_email = $2, contact_phone = $3,
         company_registration = $4, vat_number = $5, updated_at = NOW()
     WHERE property_id = $6`,
    [d.legalCompanyName, d.contactEmail, d.contactPhone, d.companyRegistration, d.vatNumber, propertyId],
  );

  await revalidateBoth(propertyId);
  return { values, errors: null, success: true };
}

export interface HighlightInput {
  label: string;
  icon: string;
  distance: string;
}

/**
 * Nearby highlights are optional, so they save independently of the Location
 * form rather than blocking it. Replace-all, for the same reason as amenities.
 */
export async function saveHighlights(
  propertyId: string,
  rows: HighlightInput[],
): Promise<{ ok: boolean }> {
  await authorize(propertyId);

  const clean = rows
    .map((r) => ({
      label: r.label.trim(),
      icon: r.icon.trim(),
      distance: r.distance.trim(),
    }))
    .filter((r) => r.label && r.icon && r.distance)
    .slice(0, 12);

  await query(`DELETE FROM property_highlights WHERE property_id = $1`, [propertyId]);
  if (clean.length > 0) {
    await query(
      `INSERT INTO property_highlights (property_id, label, icon, distance, sort_order)
       SELECT $1, l, i, d, ord - 1
       FROM UNNEST($2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS t(l, i, d, ord)`,
      [propertyId, clean.map((r) => r.label), clean.map((r) => r.icon), clean.map((r) => r.distance)],
    );
  }

  await revalidateBoth(propertyId);
  return { ok: true };
}

/**
 * Publishing is gated on the same completeness rule the rail shows, re-checked
 * here against freshly loaded data: the client's view of completeness is a
 * convenience, not an authority.
 */
export async function setPublished(
  propertyId: string,
  published: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize(propertyId);

  if (published) {
    const data = await loadEditorData(session, propertyId);
    if (!data || !canPublish(data)) {
      return { ok: false, error: "Finish every section before publishing." };
    }
  }

  await query(`UPDATE properties SET is_active = $1, updated_at = NOW() WHERE id = $2`, [
    published,
    propertyId,
  ]);

  await revalidateBoth(propertyId);
  return { ok: true };
}
