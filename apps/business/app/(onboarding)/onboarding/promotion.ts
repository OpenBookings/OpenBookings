import { slugCandidates } from "@/lib/slug";

/**
 * The slice of `host_onboarding.step_data` this promotion reads. Declared
 * structurally rather than imported from actions.ts, so this module stays
 * free of "use server" and is unit-testable on its own.
 */
export interface PromotionInput {
  userId: string;
  userEmail: string;
  stepData: {
    "core-info-text"?: {
      displayName?: string;
      tagline?: string;
      description?: string;
      houseRulesText?: string;
    };
    "core-info-location"?: {
      streetAddress?: string;
      city?: string;
      country?: string;
      postalCode?: string;
      /** [longitude, latitude] — MapLibre's order, as written by core-info-location.tsx. */
      coordinates?: [number, number] | null;
    };
    "legal-n-boring"?: {
      legalCompanyName?: string;
      vatNumber?: string;
      cocNumber?: string;
    };
    stripe_account_id?: string;
    [key: string]: unknown;
  };
}

/** Test seam: pass fakes to exercise this without a database. */
export interface PromotionDeps {
  query: <T = unknown>(text: string, values?: unknown[]) => Promise<T[]>;
  queryOne: <T = unknown>(text: string, values?: unknown[]) => Promise<T | null>;
}

export type PromotionResult =
  | { created: true; propertyId: string; slug: string }
  | { created: false; reason: "already-owns-property" | "missing-core-info" | "slug-exhausted" };

/**
 * Country → IANA timezone for the markets onboarding currently serves. A
 * country is not a timezone in general, but every country here has exactly
 * one, and the host can change it in the editor's Location section.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  PT: "Europe/Lisbon",
  AT: "Europe/Vienna",
  CH: "Europe/Zurich",
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  IE: "Europe/Dublin",
  GB: "Europe/London",
  PL: "Europe/Warsaw",
};

const DEFAULT_TIMEZONE = "Europe/Amsterdam";

/** Editable defaults, so a freshly promoted property is not missing times. */
const DEFAULT_CHECK_IN = "15:00";
const DEFAULT_CHECK_OUT = "11:00";

/** House rules arrive as one blob; blank lines are the host's own bullets. */
function toFinePrint(houseRules: string | undefined): string[] {
  if (!houseRules) return [];
  return houseRules
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

/**
 * Materialise a real `properties` row (plus its `property_content`) from the
 * onboarding scratchpad.
 *
 * Until this exists, `host_onboarding.step_data` is written by onboarding and
 * read by nothing: a host finishes the wizard and owns no property, so every
 * listings screen shows an empty state. After this, `properties` +
 * `property_content` are the source of truth and step_data is only a wizard
 * scratchpad.
 *
 * Idempotent by design — it is called on every completion and re-run by the
 * backfill script, and must never create a host's second property by accident.
 */
export async function promoteOnboardingToProperty(
  { userId, userEmail, stepData }: PromotionInput,
  deps: PromotionDeps,
): Promise<PromotionResult> {
  const existing = await deps.queryOne<{ id: string }>(
    `SELECT id FROM properties WHERE owner_user_id = $1 LIMIT 1`,
    [userId],
  );
  if (existing) return { created: false, reason: "already-owns-property" };

  const text = stepData["core-info-text"];
  const location = stepData["core-info-location"];
  const legal = stepData["legal-n-boring"];

  const displayName = text?.displayName?.trim();
  if (!displayName) return { created: false, reason: "missing-core-info" };

  const country = (location?.country || "NL").toUpperCase();
  const timezone = COUNTRY_TIMEZONE[country] ?? DEFAULT_TIMEZONE;
  const lon = location?.coordinates?.[0] ?? null;
  const lat = location?.coordinates?.[1] ?? null;

  let propertyId: string | null = null;
  let slug: string | null = null;

  // ON CONFLICT DO NOTHING rather than catching a unique violation: a caught
  // error would abort the surrounding transaction in Postgres, so the retry
  // could never run.
  for (const candidate of slugCandidates(displayName)) {
    const row = await deps.queryOne<{ id: string }>(
      `INSERT INTO properties (
         name, slug, subtitle,
         address_line_1, postal_code, city, country, timezone,
         location,
         check_in_time, check_out_time,
         stripe_account_id, owner_user_id, is_active
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7, $8,
         -- properties.location is NOT NULL (schema.ts:82), so a host whose
         -- onboarding captured no coordinates still needs a value here.
         -- POINT(0 0) is the sentinel; completion.ts treats the exact origin
         -- as "no pin" and blocks publishing until the host places one.
         ST_SetSRID(
           ST_MakePoint(COALESCE($9::float8, 0), COALESCE($10::float8, 0)),
           4326
         )::geography,
         $11::time, $12::time,
         $13, $14, false
       )
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        displayName,
        candidate,
        text?.tagline?.trim() || null,
        location?.streetAddress?.trim() || "",
        location?.postalCode?.trim() || null,
        location?.city?.trim() || "",
        country,
        timezone,
        lon,
        lat,
        DEFAULT_CHECK_IN,
        DEFAULT_CHECK_OUT,
        (stepData.stripe_account_id as string | undefined) ?? null,
        userId,
      ],
    );

    if (row) {
      propertyId = row.id;
      slug = candidate;
      break;
    }
  }

  if (!propertyId || !slug) return { created: false, reason: "slug-exhausted" };

  await deps.query(
    `INSERT INTO property_content (
       property_id, overview_description, fine_print,
       legal_company_name, vat_number, company_registration, contact_email
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (property_id) DO NOTHING`,
    [
      propertyId,
      text?.description?.trim() || null,
      toFinePrint(text?.houseRulesText),
      legal?.legalCompanyName?.trim() || null,
      legal?.vatNumber?.trim() || null,
      legal?.cocNumber?.trim() || null,
      userEmail,
    ],
  );

  return { created: true, propertyId, slug };
}
