import { sql } from "@openbookings/db";

/** One row of the `payment_methods` catalogue, as the listing page renders it. */
export interface PaymentMethodArtwork {
  code: string;
  label: string;
  /** NULL for methods with no logo (cash) — those render as their label. */
  artwork_url: string | null;
  /** Tooltip shown beside the label, e.g. cash being in-person only. */
  note: string | null;
}

/**
 * Everything the public listing page renders about a property.
 *
 * Fields sourced from `property_content` are NULL until the host fills that
 * section in from the dashboard editor, so every one of them is nullable and
 * every consumer must handle the empty case rather than render a blank shell.
 */
export interface HotelPageData {
  id: string;
  name: string;
  subtitle: string | null;
  hero_image_url: string | null;
  logo_image_url: string | null;
  gallery_images: { url: string; alt_text: string | null }[];
  lat: number;
  lon: number;

  // Address, from `properties` — the page hardcoded an Italian address before.
  address_line_1: string;
  address_line_2: string | null;
  postal_code: string | null;
  city: string;
  country: string;

  // Arrival window, from `properties`.
  check_in_time: string;
  check_in_until: string | null;
  check_out_time: string;

  // Everything below is `property_content`, and is NULL until the host fills it in.
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
  cot_fee: string | null;
  extra_bed_fee: string | null;
  pets_allowed: boolean | null;
  /**
   * Resolved from the `payment_methods` catalogue, not the raw codes the host
   * selected: the listing page needs the artwork and display name, and those
   * are a row edit rather than a deploy. Already ordered for display.
   */
  payment_methods: PaymentMethodArtwork[];
  legal_company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  company_registration: string | null;
  vat_number: string | null;

  highlights: { label: string; icon: string; distance: string }[];
}

/**
 * The single definition of the listing hero query.
 *
 * It lives here, rather than beside either caller, because there used to be two
 * near-copies — one in the page, one in /api/query/pr — and they disagreed:
 * the route's gallery filter excluded only 'logo', so it returned the hero
 * image inside the gallery while the page did not. One definition is the only
 * durable fix for that class of bug.
 *
 * `property_content` is LEFT JOINed and the highlights are a correlated
 * aggregate, so this is still one round trip.
 */
export function buildHeroQuery(slug: string) {
  return sql`
  SELECT
    p.id,
    p.name,
    p.subtitle,
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lon,
    p.address_line_1, p.address_line_2, p.postal_code, p.city, p.country,
    to_char(p.check_in_time,  'HH24:MI') AS check_in_time,
    to_char(p.check_in_until, 'HH24:MI') AS check_in_until,
    to_char(p.check_out_time, 'HH24:MI') AS check_out_time,
    c.overview_headline, c.overview_description, c.location_about,
    c.cta_headline, c.cta_body, c.fine_print,
    c.reception_24h, c.free_cancellation_days, c.prepayment_required,
    c.children_welcome, c.min_check_in_age, c.cot_policy, c.cot_fee,
    c.extra_bed_fee, c.pets_allowed,
    c.legal_company_name, c.contact_email, c.contact_phone,
    c.company_registration, c.vat_number,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'label', h.label, 'icon', h.icon, 'distance', h.distance
      ) ORDER BY h.sort_order), '[]'::json)
      FROM property_highlights h WHERE h.property_id = p.id
    ) AS highlights,
    -- The host stores codes; the page needs artwork and names. Resolving here
    -- keeps that a catalogue row rather than a map in the component. A code
    -- with no active catalogue row simply drops out, and a property with no
    -- content row at all yields '[]' (= ANY(NULL) matches nothing).
    (
      SELECT COALESCE(json_agg(json_build_object(
        'code', pm.code, 'label', pm.label,
        'artwork_url', pm.artwork_url, 'note', pm.note
      ) ORDER BY pm.sort_order, pm.label), '[]'::json)
      FROM payment_methods pm
      WHERE pm.is_active AND pm.code = ANY(c.payment_methods)
    ) AS payment_methods,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi."group" = 'hero-image' THEN 0 ELSE 1 END) ASC, pi.sort_order ASC, pi.created_at ASC
      LIMIT 1
    ) AS hero_image_url,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id AND pi."group" = 'logo'
      LIMIT 1
    ) AS logo_image_url,
    (
      SELECT COALESCE(json_agg(json_build_object('url', pi.url, 'alt_text', pi.alt_text) ORDER BY pi.sort_order ASC, pi.created_at ASC), '[]'::json)
      FROM (
        SELECT pi2.url, pi2.alt_text, pi2.sort_order, pi2.created_at
        FROM property_images pi2
        WHERE pi2.property_id = p.id AND pi2."group" = 'gallery'
        ORDER BY pi2.sort_order ASC, pi2.created_at ASC
        LIMIT 20
      ) pi
    ) AS gallery_images
  FROM properties p
  LEFT JOIN property_content c ON c.property_id = p.id
  WHERE p.slug = ${slug} AND p.is_active
  LIMIT 1
`;
}
