import type { TouristTaxRule } from "@openbookings/pricing";

/** The groups the editor's nav rail lists, in the order the guest sees them. */
export const SECTION_IDS = [
  "identity",
  "photos",
  "overview",
  "policies",
  "tourist-tax",
  "location",
  "legal",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  identity: "Identity",
  photos: "Photos",
  overview: "Overview",
  policies: "Policies",
  "tourist-tax": "Tourist tax",
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
  /** The host placed the pin by hand, so address edits leave it alone. */
  pinSetManually: boolean;
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

/** A saved row of `tourist_tax_rules`. */
export interface TouristTaxRuleRecord extends TouristTaxRule {
  id: string;
}

export interface TouristTaxData {
  /** Every rule, oldest first. */
  rules: TouristTaxRuleRecord[];
  /** `properties.commission_rate`, e.g. 0.045. The calculator shows it. */
  commissionRate: number;
  /**
   * Today in the property's own time zone, "YYYY-MM-DD". Decides which rule is
   * current and which may still be deleted, the same way the save path does.
   */
  today: string;
}

/** Everything the editor screen needs, loaded in one pass. */
export interface PropertyEditorData {
  property: PropertyRecord;
  content: PropertyContentRecord;
  images: PropertyImageRecord[];
  highlights: HighlightRecord[];
  amenityIds: string[];
  touristTax: TouristTaxData;
}

export type { FormState } from "../../_lib/editor";
