import { getHostScopedDb, type SessionLike } from "@openbookings/authz";
import { query as dbQuery } from "@openbookings/db";
import type {
  HighlightRecord,
  PropertyContentRecord,
  PropertyEditorData,
  PropertyImageRecord,
  PropertyRecord,
} from "./types";

export interface AmenityCatalogEntry {
  id: string;
  label: string;
  icon: string;
  category: string;
}

/**
 * Two queries, not six.
 *
 * The first resolves which property we are editing and its 1:1 content row; the
 * second fans out its three collections as JSON aggregates. Splitting them is
 * not a round-trip optimisation — the second query needs the property id the
 * first returns, and joining the collections into the first would multiply the
 * property row by images × highlights × amenities.
 *
 * Times come back through to_char so the domain sees "15:00" and not Postgres's
 * "15:00:00", which an <input type="time"> will not accept.
 */

interface PropertyRow {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  address_line_1: string;
  address_line_2: string | null;
  postal_code: string | null;
  city: string;
  country: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
  check_in_time: string;
  check_in_until: string | null;
  check_out_time: string;
  is_active: boolean;
  overview_headline: string | null;
  overview_description: string | null;
  location_about: string | null;
  cta_headline: string | null;
  cta_body: string | null;
  fine_print: string[] | null;
  reception_24h: boolean | null;
  free_cancellation_days: number | null;
  prepayment_required: boolean | null;
  children_welcome: boolean | null;
  min_check_in_age: number | null;
  cot_policy: "free" | "paid" | "unavailable" | null;
  /** bigint — node-postgres hands int8 back as a string. */
  cot_fee: string | null;
  extra_bed_fee: string | null;
  pets_allowed: boolean | null;
  payment_methods: string[] | null;
  legal_company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  company_registration: string | null;
  vat_number: string | null;
}

interface CollectionsRow {
  images: PropertyImageRecord[] | null;
  highlights: HighlightRecord[] | null;
  amenity_ids: string[] | null;
}

/** int8 arrives as a string; `+` on it concatenates. Convert deliberately. */
const money = (v: string | null): number | null => (v === null ? null : Number(v));

export async function loadEditorData(
  session: SessionLike,
  propertyId?: string,
): Promise<PropertyEditorData | null> {
  const host = getHostScopedDb(session);

  const property = await host.queryOne<PropertyRow>(
    `SELECT
       p.id, p.name, p.slug, p.subtitle,
       p.address_line_1, p.address_line_2, p.postal_code, p.city, p.country, p.timezone,
       ST_Y(p.location::geometry) AS lat,
       ST_X(p.location::geometry) AS lon,
       to_char(p.check_in_time,  'HH24:MI') AS check_in_time,
       to_char(p.check_in_until, 'HH24:MI') AS check_in_until,
       to_char(p.check_out_time, 'HH24:MI') AS check_out_time,
       p.is_active,
       c.overview_headline, c.overview_description, c.location_about,
       c.cta_headline, c.cta_body, c.fine_print,
       c.reception_24h, c.free_cancellation_days, c.prepayment_required,
       c.children_welcome, c.min_check_in_age,
       c.cot_policy, c.cot_fee, c.extra_bed_fee, c.pets_allowed, c.payment_methods,
       c.legal_company_name, c.contact_email, c.contact_phone,
       c.company_registration, c.vat_number
     FROM properties p
     LEFT JOIN property_content c ON c.property_id = p.id
     WHERE p.owner_user_id = $1
       AND ($2::uuid IS NULL OR p.id = $2::uuid)
     ORDER BY p.name
     LIMIT 1`,
    [propertyId ?? null],
  );

  if (!property) return null;

  const collections = await host.queryOne<CollectionsRow>(
    `SELECT
       (SELECT COALESCE(json_agg(json_build_object(
          'id', i.id, 'url', i.url, 'group', i."group",
          'sortOrder', i.sort_order, 'altText', i.alt_text
        ) ORDER BY i.sort_order, i.created_at), '[]'::json)
        FROM property_images i WHERE i.property_id = p.id) AS images,
       (SELECT COALESCE(json_agg(json_build_object(
          'id', h.id, 'label', h.label, 'icon', h.icon,
          'distance', h.distance, 'sortOrder', h.sort_order
        ) ORDER BY h.sort_order), '[]'::json)
        FROM property_highlights h WHERE h.property_id = p.id) AS highlights,
       (SELECT COALESCE(array_agg(pa.amenity_id), ARRAY[]::uuid[])
        FROM property_amenities pa WHERE pa.property_id = p.id) AS amenity_ids
     FROM properties p
     WHERE p.owner_user_id = $1 AND p.id = $2::uuid`,
    [property.id],
  );

  const record: PropertyRecord = {
    id: property.id,
    name: property.name,
    slug: property.slug,
    subtitle: property.subtitle,
    addressLine1: property.address_line_1,
    addressLine2: property.address_line_2,
    postalCode: property.postal_code,
    city: property.city,
    country: property.country,
    timezone: property.timezone,
    lat: property.lat,
    lon: property.lon,
    checkInTime: property.check_in_time,
    checkInUntil: property.check_in_until,
    checkOutTime: property.check_out_time,
    isActive: property.is_active,
  };

  // A property with no property_content row yet reads as "everything empty",
  // which is exactly what completion.ts should see. Defaults here match the
  // column defaults so a missing row and a fresh row behave identically.
  const content: PropertyContentRecord = {
    overviewHeadline: property.overview_headline,
    overviewDescription: property.overview_description,
    locationAbout: property.location_about,
    ctaHeadline: property.cta_headline,
    ctaBody: property.cta_body,
    finePrint: property.fine_print ?? [],
    reception24h: property.reception_24h ?? false,
    freeCancellationDays: property.free_cancellation_days,
    prepaymentRequired: property.prepayment_required ?? false,
    childrenWelcome: property.children_welcome ?? true,
    minCheckInAge: property.min_check_in_age,
    cotPolicy: property.cot_policy,
    cotFee: money(property.cot_fee),
    extraBedFee: money(property.extra_bed_fee),
    petsAllowed: property.pets_allowed ?? false,
    paymentMethods: property.payment_methods ?? [],
    legalCompanyName: property.legal_company_name,
    contactEmail: property.contact_email,
    contactPhone: property.contact_phone,
    companyRegistration: property.company_registration,
    vatNumber: property.vat_number,
  };

  return {
    property: record,
    content,
    images: collections?.images ?? [],
    highlights: collections?.highlights ?? [],
    amenityIds: collections?.amenity_ids ?? [],
  };
}

/** The global amenity catalog. Not host-scoped — every host picks from the same list. */
export async function loadAmenityCatalog(): Promise<AmenityCatalogEntry[]> {
  return dbQuery<AmenityCatalogEntry>(
    `SELECT id, label, icon, category
     FROM amenities
     ORDER BY category, sort_order, label`,
  );
}
