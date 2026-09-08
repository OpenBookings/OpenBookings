/** The six groups the editor's nav rail lists, in the order the guest sees them. */
export const SECTION_IDS = [
  "identity",
  "photos",
  "overview",
  "policies",
  "location",
  "legal",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  identity: "Identity",
  photos: "Photos",
  overview: "Overview",
  policies: "Policies",
  location: "Location",
  legal: "Legal",
};

export type ImageGroup = "hero-image" | "logo" | "gallery";

export type CotPolicy = "free" | "paid" | "unavailable";

/** Columns of `properties` this editor reads or writes. Times are "HH:MM". */
export interface PropertyRecord {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  city: string;
  country: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
  checkInTime: string;
  checkInUntil: string | null;
  checkOutTime: string;
  isActive: boolean;
}

/** All of `property_content`. Money fields are whole currency units. */
export interface PropertyContentRecord {
  overviewHeadline: string | null;
  overviewDescription: string | null;
  locationAbout: string | null;
  ctaHeadline: string | null;
  ctaBody: string | null;
  finePrint: string[];
  reception24h: boolean;
  freeCancellationDays: number | null;
  prepaymentRequired: boolean;
  childrenWelcome: boolean;
  minCheckInAge: number | null;
  cotPolicy: CotPolicy | null;
  cotFee: number | null;
  extraBedFee: number | null;
  petsAllowed: boolean;
  paymentMethods: string[];
  legalCompanyName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyRegistration: string | null;
  vatNumber: string | null;
}

export interface PropertyImageRecord {
  id: string;
  url: string;
  group: ImageGroup;
  sortOrder: number;
  altText: string | null;
}

export interface HighlightRecord {
  id: string;
  label: string;
  icon: string;
  distance: string;
  sortOrder: number;
}

/** Everything the editor screen needs, loaded in one pass. */
export interface PropertyEditorData {
  property: PropertyRecord;
  content: PropertyContentRecord;
  images: PropertyImageRecord[];
  highlights: HighlightRecord[];
  amenityIds: string[];
}

/**
 * The shape every section's server action returns, consumed by useActionState.
 * `values` is echoed back so a rejected save re-renders what the host typed
 * rather than throwing it away.
 */
export interface FormState<T> {
  values: T;
  errors: Record<string, string[]> | null;
  success: boolean;
}
