/**
 * The fixed vocabularies the Rooms editor offers. Everything is stored by key,
 * never by label, so the labels can be localised later without a data
 * migration. Adding an entry is a one-line change here; removing one strands
 * the rows that hold its key, so retire entries rather than deleting them.
 */

// ─────────────────────────────────────────────
// Beds
// ─────────────────────────────────────────────

export const BED_TYPES = [
  { key: "single", label: "Single", plural: "Singles" },
  { key: "double", label: "Double", plural: "Doubles" },
  { key: "queen", label: "Queen", plural: "Queens" },
  { key: "king", label: "King", plural: "Kings" },
  { key: "sofa_bed", label: "Sofa bed", plural: "Sofa beds" },
  { key: "bunk_bed", label: "Bunk bed", plural: "Bunk beds" },
] as const;

export type BedTypeKey = (typeof BED_TYPES)[number]["key"];
export type BedConfig = Partial<Record<BedTypeKey, number>>;

export const BED_TYPE_KEYS = BED_TYPES.map((b) => b.key) as BedTypeKey[];

// ─────────────────────────────────────────────
// Room amenities
// ─────────────────────────────────────────────

export const ROOM_AMENITY_GROUPS = [
  "Bathroom",
  "Comfort",
  "View and outdoor",
  "Tech",
  "Accessibility",
] as const;

export type RoomAmenityGroup = (typeof ROOM_AMENITY_GROUPS)[number];

interface RoomAmenity {
  key: string;
  label: string;
  group: RoomAmenityGroup;
  /**
   * The matching row's label in the shared `amenities` catalogue, where one
   * exists. Used for two things only: reading a room's legacy `room_amenities`
   * rows into keys, and mirroring the featured keys back into `room_amenities`,
   * which is what the guest room card reads its chips from today.
   */
  catalogLabel?: string;
}

/**
 * Room-level only. Property-wide facilities (restaurant, spa, pool, rooftop
 * bar) belong on the Property page and are deliberately absent.
 */
export const ROOM_AMENITIES: readonly RoomAmenity[] = [
  // Bathroom
  { key: "private_bathroom", label: "Private bathroom", group: "Bathroom" },
  { key: "rain_shower", label: "Rain shower", group: "Bathroom", catalogLabel: "Rain Shower" },
  { key: "walk_in_shower", label: "Walk-in shower", group: "Bathroom" },
  { key: "bathtub", label: "Bathtub", group: "Bathroom", catalogLabel: "Bathtub" },
  { key: "jacuzzi", label: "Jacuzzi", group: "Bathroom", catalogLabel: "Jacuzzi" },
  { key: "hairdryer", label: "Hairdryer", group: "Bathroom", catalogLabel: "Hairdryer" },
  { key: "bathrobes", label: "Bathrobes", group: "Bathroom", catalogLabel: "Bathrobes" },
  { key: "slippers", label: "Slippers", group: "Bathroom", catalogLabel: "Slippers" },
  { key: "toiletries", label: "Free toiletries", group: "Bathroom" },

  // Comfort
  { key: "air_conditioning", label: "Air conditioning", group: "Comfort", catalogLabel: "Air Conditioning" },
  { key: "heating", label: "Heating", group: "Comfort", catalogLabel: "Heating" },
  { key: "blackout_curtains", label: "Blackout curtains", group: "Comfort", catalogLabel: "Blackout Curtains" },
  { key: "soundproofing", label: "Soundproofing", group: "Comfort" },
  { key: "fireplace", label: "Fireplace", group: "Comfort", catalogLabel: "Fireplace" },
  { key: "coffee_machine", label: "Coffee machine", group: "Comfort", catalogLabel: "Coffee Machine" },
  { key: "kettle", label: "Kettle", group: "Comfort", catalogLabel: "Kettle" },
  { key: "minibar", label: "Minibar", group: "Comfort", catalogLabel: "Mini Bar" },
  { key: "safe", label: "In-room safe", group: "Comfort", catalogLabel: "Safe" },
  { key: "work_desk", label: "Work desk", group: "Comfort", catalogLabel: "Work Desk" },
  { key: "iron", label: "Iron and ironing board", group: "Comfort", catalogLabel: "Iron & Ironing Board" },

  // View and outdoor
  { key: "sea_view", label: "Sea view", group: "View and outdoor", catalogLabel: "Sea View" },
  { key: "city_view", label: "City view", group: "View and outdoor", catalogLabel: "City View" },
  { key: "garden_view", label: "Garden view", group: "View and outdoor", catalogLabel: "Garden View" },
  { key: "mountain_view", label: "Mountain view", group: "View and outdoor", catalogLabel: "Mountain View" },
  { key: "balcony", label: "Balcony", group: "View and outdoor", catalogLabel: "Balcony" },
  { key: "terrace", label: "Terrace", group: "View and outdoor", catalogLabel: "Terrace" },
  { key: "private_pool", label: "Private pool", group: "View and outdoor", catalogLabel: "Private Pool" },

  // Tech
  { key: "wifi", label: "Free Wi-Fi", group: "Tech", catalogLabel: "Free Wi-Fi" },
  { key: "smart_tv", label: "Smart TV", group: "Tech", catalogLabel: "Smart TV" },
  { key: "flat_screen_tv", label: "Flat-screen TV", group: "Tech", catalogLabel: "Flat Screen TV" },
  { key: "streaming", label: "Streaming services", group: "Tech" },
  { key: "usb_charging", label: "USB charging points", group: "Tech" },
  { key: "bluetooth_speaker", label: "Bluetooth speaker", group: "Tech" },

  // Accessibility
  { key: "wheelchair_accessible", label: "Wheelchair accessible", group: "Accessibility", catalogLabel: "Accessibility" },
  { key: "step_free_access", label: "Step-free access", group: "Accessibility" },
  { key: "roll_in_shower", label: "Roll-in shower", group: "Accessibility" },
  { key: "grab_rails", label: "Grab rails", group: "Accessibility" },
  { key: "lowered_fixtures", label: "Lowered sink and switches", group: "Accessibility" },
  { key: "visual_alarms", label: "Visual fire alarm", group: "Accessibility" },
];

export const ROOM_AMENITY_KEYS = ROOM_AMENITIES.map((a) => a.key);
export const ROOM_AMENITY_BY_KEY = new Map(ROOM_AMENITIES.map((a) => [a.key, a]));

/** Featured amenities appear as chips on the guest room card; more than six crowds it. */
export const MAX_FEATURED_AMENITIES = 6;

// ─────────────────────────────────────────────
// Rate plans
// ─────────────────────────────────────────────

export const RATE_EXTRAS = [
  { key: "parking", label: "Parking" },
  { key: "spa_access", label: "Spa access" },
  { key: "early_check_in", label: "Early check-in" },
  { key: "late_check_out", label: "Late check-out" },
  { key: "welcome_drink", label: "Welcome drink" },
] as const;

export type RateExtraKey = (typeof RATE_EXTRAS)[number]["key"];
export const RATE_EXTRA_KEYS = RATE_EXTRAS.map((e) => e.key) as RateExtraKey[];

/** "Book at least" — days before arrival. 0 is same day. */
export const MIN_ADVANCE_OPTIONS = [0, 1, 2, 3, 7, 14] as const;
/** "Book at most" — days ahead. null is no limit. */
export const MAX_ADVANCE_OPTIONS = [null, 90, 180, 365] as const;

// ─────────────────────────────────────────────
// Field limits — shared by the forms, the schemas and the completion rules,
// so a limit can only ever be stated once.
// ─────────────────────────────────────────────

export const LIMITS = {
  roomName: { min: 2, max: 60 },
  roomDescription: { min: 40, max: 400 },
  /** numeric(6,1) holds up to 99999.9; nothing real comes close. */
  sizeM2: { max: 9999 },
  adults: { min: 1, max: 10 },
  children: { min: 0, max: 10 },
  bedsPerType: { max: 20 },
  units: { min: 1, max: 99 },
  minPhotos: 3,
  rateName: { min: 2, max: 60 },
  rateDescription: { max: 200 },
  otherInclusion: { max: 120 },
  cancellation: { max: 500 },
} as const;
