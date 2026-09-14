import { SECTION_IDS, type PropertyEditorData, type SectionId } from "./types";

export interface SectionStatus {
  complete: boolean;
  /** Human-readable labels, printed directly in rail and publish tooltips. */
  missing: string[];
}

/** Minimum gallery photos before a listing looks like a listing. */
const MIN_GALLERY = 3;
/** Matches overviewSchema's floor — the two must not drift. */
const MIN_DESCRIPTION = 120;

const isBlank = (v: string | null | undefined) => !v || v.trim().length === 0;

/**
 * A section's required fields, as label → satisfied predicate. Declaring them
 * as data rather than as if-branches is what lets `missing` stay ordered and
 * lets a new required field be added in one line.
 */
type Rule = [label: string, satisfied: (d: PropertyEditorData) => boolean];

const RULES: Record<SectionId, Rule[]> = {
  identity: [
    ["Property name", (d) => !isBlank(d.property.name)],
    ["Tagline", (d) => !isBlank(d.property.subtitle)],
  ],
  photos: [
    ["Hero image", (d) => d.images.some((i) => i.group === "hero-image")],
    [
      `At least ${MIN_GALLERY} gallery photos`,
      (d) => d.images.filter((i) => i.group === "gallery").length >= MIN_GALLERY,
    ],
    [
      "Alt text on every photo",
      // Only the gallery: the hero is decorative behind the property name, and
      // the logo already falls back to the name in the page footer.
      (d) => d.images.filter((i) => i.group === "gallery").every((i) => !isBlank(i.altText)),
    ],
  ],
  overview: [
    ["Headline", (d) => !isBlank(d.content.overviewHeadline)],
    [
      "Description",
      (d) => (d.content.overviewDescription?.trim().length ?? 0) >= MIN_DESCRIPTION,
    ],
    ["At least one amenity", (d) => d.amenityIds.length > 0],
    ["Closing headline", (d) => !isBlank(d.content.ctaHeadline)],
    ["Closing message", (d) => !isBlank(d.content.ctaBody)],
  ],
  policies: [
    ["Check-in time", (d) => !isBlank(d.property.checkInTime)],
    ["Check-out time", (d) => !isBlank(d.property.checkOutTime)],
    // Zero is a real answer here ("no free cancellation"), so test for null.
    ["Free cancellation window", (d) => d.content.freeCancellationDays !== null],
    // Unlike freeCancellationDays, minCheckInAge of 0 is not a real policy; the
    // save path rejects it with .min(1). Reject 0 here for consistency.
    ["Minimum check-in age", (d) => d.content.minCheckInAge !== null && d.content.minCheckInAge >= 1],
    ["Accepted payment methods", (d) => d.content.paymentMethods.length > 0],
    ["Fine print", (d) => d.content.finePrint.length > 0],
    ["Cot fee", (d) => d.content.cotPolicy !== "paid" || d.content.cotFee !== null],
  ],
  location: [
    ["About", (d) => !isBlank(d.content.locationAbout)],
    ["Address", (d) => !isBlank(d.property.addressLine1)],
    ["Postal code", (d) => !isBlank(d.property.postalCode)],
    ["City", (d) => !isBlank(d.property.city)],
    ["Country", (d) => !isBlank(d.property.country)],
    ["Timezone", (d) => !isBlank(d.property.timezone)],
    // `properties.location` is NOT NULL, so the onboarding promotion writes
    // POINT(0 0) for a host who never placed a pin — the pin arrives here as
    // 0,0 rather than null. Treating the exact origin as "no pin" is what
    // stops that host publishing a listing whose map points at the Gulf of
    // Guinea. Null Island is open ocean; no property is there.
    [
      "Map pin",
      (d) =>
        d.property.lat !== null &&
        d.property.lon !== null &&
        !(d.property.lat === 0 && d.property.lon === 0),
    ],
  ],
  legal: [
    ["Legal company name", (d) => !isBlank(d.content.legalCompanyName)],
    ["Contact email", (d) => !isBlank(d.content.contactEmail)],
    ["Contact phone", (d) => !isBlank(d.content.contactPhone)],
    ["Company registration", (d) => !isBlank(d.content.companyRegistration)],
    ["VAT number", (d) => !isBlank(d.content.vatNumber)],
  ],
};

export function sectionStatus(section: SectionId, data: PropertyEditorData): SectionStatus {
  const missing = RULES[section].filter(([, ok]) => !ok(data)).map(([label]) => label);
  return { complete: missing.length === 0, missing };
}

export function allSectionStatuses(
  data: PropertyEditorData,
): Record<SectionId, SectionStatus> {
  return Object.fromEntries(
    SECTION_IDS.map((id) => [id, sectionStatus(id, data)]),
  ) as Record<SectionId, SectionStatus>;
}

export function completedCount(data: PropertyEditorData): number {
  return SECTION_IDS.filter((id) => sectionStatus(id, data).complete).length;
}

/**
 * A listing goes live only when every section is complete. This is the same
 * rule the save path enforces per section, so the rail and the save can never
 * disagree about whether a section is done.
 */
export function canPublish(data: PropertyEditorData): boolean {
  return completedCount(data) === SECTION_IDS.length;
}
