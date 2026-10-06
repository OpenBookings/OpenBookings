import type { BedConfig, RateExtraKey } from "./constants";

/** The five sections the room editor's rail lists, in the order a host fills them in. */
export const ROOM_SECTION_IDS = ["identity", "space", "photos", "amenities", "rates"] as const;

export type RoomSectionId = (typeof ROOM_SECTION_IDS)[number];

export const ROOM_SECTION_LABELS: Record<RoomSectionId, string> = {
  identity: "Identity",
  space: "Space",
  photos: "Photos",
  amenities: "Amenities",
  rates: "Rates",
};

/**
 * Derived, not stored: `archived_at` set → archived; otherwise `is_active` →
 * published; otherwise draft. Keeping `is_active` as "published" is what lets
 * the guest page and search keep filtering on the column they already use.
 */
export type RoomStatus = "draft" | "published" | "archived";

export interface RoomRecord {
  id: string;
  propertyId: string;
  name: string;
  description: string | null;
  /** numeric(6,1), already converted from the string node-postgres returns. */
  sizeM2: number | null;
  beds: BedConfig;
  maxAdults: number;
  maxChildren: number;
  /** `rooms.total_units` — the baseline R&A's availability is computed from. */
  units: number;
  amenityKeys: string[];
  featuredAmenityKeys: string[];
  sortOrder: number;
  status: RoomStatus;
}

export interface RoomPhotoRecord {
  id: string;
  url: string;
  sortOrder: number;
  altText: string | null;
}

export interface RatePlanRecord {
  id: string;
  roomId: string;
  name: string;
  description: string | null;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  extras: RateExtraKey[];
  otherInclusion: string | null;
  /** Days before arrival. 0 = same day. */
  minAdvanceDays: number;
  /** Days ahead. null = no limit. */
  maxAdvanceDays: number | null;
  cancellationText: string | null;
  active: boolean;
  /**
   * Whether R&A has set a base rate (`bar > 0`). The editor shows no price, but
   * it has to know whether one exists: an unpriced rate must not go on sale,
   * because guest search reads `bar` as the nightly price.
   */
  priced: boolean;
  sortOrder: number;
}

/** Everything the room editor screen needs, loaded in one pass. */
export interface RoomEditorData {
  room: RoomRecord;
  photos: RoomPhotoRecord[];
  rates: RatePlanRecord[];
  property: { id: string; name: string };
}

/** One row of the Rooms index. */
export interface RoomListItem {
  id: string;
  name: string;
  sizeM2: number | null;
  beds: BedConfig;
  legacyBedLabel: string | null;
  units: number;
  activeRates: number;
  coverUrl: string | null;
  status: Exclude<RoomStatus, "archived">;
  sortOrder: number;
}
