import {
  BED_TYPES,
  MAX_FEATURED_AMENITIES,
  RATE_EXTRAS,
  ROOM_AMENITIES,
  type BedConfig,
  type BedTypeKey,
} from "./constants";

/**
 * Every label the editor derives rather than stores. Pure, so the index, the
 * editor, the rate table and the server all print the same thing — and so
 * it can be tested without a browser or a database.
 */

// ─────────────────────────────────────────────
// Space
// ─────────────────────────────────────────────

export function totalBeds(beds: BedConfig): number {
  return BED_TYPES.reduce((sum, { key }) => sum + (beds[key] ?? 0), 0);
}

/**
 * "King" for the common single-bed room, "1 King · 1 Sofa bed" once there is
 * more than one bed. Order follows BED_TYPES, so the same room always reads
 * the same way. Empty string when there are no beds.
 */
export function bedLabel(beds: BedConfig): string {
  const present = BED_TYPES.filter(({ key }) => (beds[key] ?? 0) > 0);
  if (present.length === 1 && beds[present[0].key] === 1) return present[0].label;
  return present
    .map(({ key, label, plural }) => {
      const n = beds[key]!;
      return `${n} ${n === 1 ? label : plural}`;
    })
    .join(" · ");
}

/** "35 m²", "35.5 m²" — never "35.0 m²". */
export function formatSize(m2: number): string {
  return `${Number(m2.toFixed(1))} m²`;
}

/**
 * The guest card's summary line, e.g. "35 m² · King". `legacyBedLabel` covers
 * rooms whose beds were never entered as counts: their free-text `bed_type` is
 * still what guests see, so it is what the host should see too.
 */
export function roomSummary(
  sizeM2: number | null,
  beds: BedConfig,
  legacyBedLabel: string | null = null,
): string {
  const bed = bedLabel(beds) || legacyBedLabel || "";
  return [sizeM2 !== null && sizeM2 > 0 ? formatSize(sizeM2) : "", bed]
    .filter(Boolean)
    .join(" · ");
}

/** Best effort: a legacy `bed_type` that is exactly one bed type's name becomes one of it. */
export function bedsFromLegacyLabel(label: string | null): BedConfig {
  if (!label) return {};
  const match = BED_TYPES.find((b) => b.label.toLowerCase() === label.trim().toLowerCase());
  return match ? { [match.key]: 1 } : {};
}

/** Keeps only known bed types with sane counts. The column is jsonb; trust nothing in it. */
export function normaliseBeds(raw: unknown): BedConfig {
  if (!raw || typeof raw !== "object") return {};
  const out: BedConfig = {};
  for (const { key } of BED_TYPES) {
    const n = (raw as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out[key as BedTypeKey] = n;
  }
  return out;
}

// ─────────────────────────────────────────────
// Amenities
// ─────────────────────────────────────────────

const KEY_BY_CATALOG_LABEL = new Map(
  ROOM_AMENITIES.filter((a) => a.catalogLabel).map((a) => [a.catalogLabel!, a.key]),
);

/**
 * A room never saved from this editor has no `amenity_keys`, only legacy
 * `room_amenities` rows. Reading those in means a host opening an existing
 * room sees what guests see today rather than an empty checklist. The legacy
 * rows are exactly what the guest card shows as chips, so they also become
 * the featured set (up to the cap).
 */
export function amenitiesFromLegacy(catalogLabels: string[]): {
  amenityKeys: string[];
  featuredAmenityKeys: string[];
} {
  const keys = [
    ...new Set(
      catalogLabels.map((l) => KEY_BY_CATALOG_LABEL.get(l)).filter((k): k is string => !!k),
    ),
  ];
  return { amenityKeys: keys, featuredAmenityKeys: keys.slice(0, MAX_FEATURED_AMENITIES) };
}

/** The catalogue labels to mirror into `room_amenities` for these featured keys. */
export function catalogLabelsFor(keys: string[]): string[] {
  return ROOM_AMENITIES.filter((a) => a.catalogLabel && keys.includes(a.key)).map(
    (a) => a.catalogLabel!,
  );
}

// ─────────────────────────────────────────────
// Rates
// ─────────────────────────────────────────────

const MEAL_NAMES = ["Breakfast", "Lunch", "Dinner"] as const;

/**
 * The guest-facing name for a meal combination. The board terms are the ones
 * guests already know; anything else is listed plainly.
 */
export function mealLabel(meals: { breakfast: boolean; lunch: boolean; dinner: boolean }): string {
  const { breakfast, lunch, dinner } = meals;
  if (!breakfast && !lunch && !dinner) return "Room only";
  if (breakfast && lunch && dinner) return "Full board";
  if (breakfast && dinner && !lunch) return "Half board";

  const included = MEAL_NAMES.filter((_, i) => [breakfast, lunch, dinner][i]);
  if (included.length === 1) return `${included[0]} included`;
  // Two meals, and not breakfast + dinner (that is half board, above).
  return `${included[0]} and ${included[1].toLowerCase()}`;
}

/**
 * The rate table's Includes column: meals, then extras, then the free-text
 * line. A single meal reads as its name ("Breakfast · Parking") because the
 * column is already about what is included.
 */
export function includesSummary(rate: {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  extras: readonly string[];
  otherInclusion: string | null;
}): string {
  const meals = mealLabel(rate);
  const mealPart =
    meals === "Room only" ? null : meals.endsWith(" included") ? meals.replace(" included", "") : meals;
  const extras = RATE_EXTRAS.filter((e) => rate.extras.includes(e.key)).map((e) => e.label);
  const other = rate.otherInclusion?.trim() || null;
  const parts = [mealPart, ...extras, other].filter((p): p is string => !!p);
  return parts.length === 0 ? "Room only" : parts.join(" · ");
}

export function minAdvanceLabel(days: number): string {
  if (days === 0) return "Same day";
  return `${days} day${days === 1 ? "" : "s"} before arrival`;
}

export function maxAdvanceLabel(days: number | null): string {
  return days === null ? "No limit" : `${days} days ahead`;
}

/** The rate table's Conditions column. */
export function conditionsSummary(minAdvanceDays: number, maxAdvanceDays: number | null): string {
  const min = minAdvanceDays > 0;
  const max = maxAdvanceDays !== null;
  if (min && max) return `Book ${minAdvanceDays}–${maxAdvanceDays} days ahead`;
  if (min) return `Book ${minAdvanceDays}+ day${minAdvanceDays === 1 ? "" : "s"} ahead`;
  if (max) return `Book up to ${maxAdvanceDays} days ahead`;
  return "None";
}

/** First line of the policy, for the table. The Sheet and the guest see it whole. */
export function cancellationPreview(text: string | null): string | null {
  const first = text?.trim().split(/\r?\n/)[0]?.trim();
  return first ? first : null;
}

/** "Bed & Breakfast" → "Bed & Breakfast (copy)", kept inside the name limit. */
export function copyName(name: string, max: number): string {
  const suffix = " (copy)";
  return `${name.slice(0, max - suffix.length).trimEnd()}${suffix}`;
}
