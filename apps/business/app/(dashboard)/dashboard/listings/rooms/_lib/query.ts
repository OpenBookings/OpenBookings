import { getHostScopedDb, type SessionLike } from "@openbookings/authz";
import { RATE_EXTRA_KEYS, type RateExtraKey } from "./constants";
import { amenitiesFromLegacy, bedsFromLegacyLabel, normaliseBeds } from "./derive";
import type {
  RatePlanRecord,
  RoomEditorData,
  RoomListItem,
  RoomPhotoRecord,
  RoomStatus,
} from "./types";

/**
 * The Rooms editor's read layer. Host-scoped through getHostScopedDb, exactly
 * like the Property editor and R&A: `$1` is always the verified owner id, and
 * no room or rate id from the URL reaches SQL without being joined back to it.
 *
 * `size_sqm` is numeric and node-postgres hands numerics back as strings, so
 * it crosses into the domain through `num`. `bar` is never read as a price
 * here — only as "has R&A priced this yet".
 */

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * The host-scoped query pair: `$1` is bound to the verified owner id. Taken as
 * a parameter only so the DB-backed tests can run the loaders inside their own
 * transaction; callers leave it to the default.
 */
type HostDb = Pick<ReturnType<typeof getHostScopedDb>, "query" | "queryOne">;

function statusOf(row: { is_active: boolean; archived_at: string | null }): RoomStatus {
  if (row.archived_at) return "archived";
  return row.is_active ? "published" : "draft";
}

// ─────────────────────────────────────────────
// Rooms index
// ─────────────────────────────────────────────

interface IndexRow {
  id: string;
  name: string;
  size_sqm: string | null;
  bed_config: unknown;
  bed_type: string | null;
  total_units: number;
  is_active: boolean;
  archived_at: string | null;
  sort_order: number;
  cover_url: string | null;
  active_rates: number;
}

export interface RoomsIndexData {
  property: { id: string; name: string };
  rooms: RoomListItem[];
}

export async function loadRoomsIndex(
  session: SessionLike,
  propertyId?: string,
  host: HostDb = getHostScopedDb(session),
): Promise<RoomsIndexData | null> {
  // Same resolution as the Property page: the requested property if the host
  // owns it, otherwise their first.
  const property = await host.queryOne<{ id: string; name: string }>(
    `SELECT p.id, p.name FROM properties p
     WHERE p.owner_user_id = $1
       AND ($2::uuid IS NULL OR p.id = $2::uuid)
     ORDER BY p.name
     LIMIT 1`,
    [propertyId ?? null],
  );
  if (!property) return null;

  const rows = await host.query<IndexRow>(
    `SELECT
       r.id, r.name, r.size_sqm, r.bed_config, r.bed_type, r.total_units,
       r.is_active, r.archived_at, r.sort_order,
       (SELECT ri.url FROM room_images ri
        WHERE ri.room_id = r.id
        ORDER BY ri.sort_order, ri.created_at
        LIMIT 1) AS cover_url,
       (SELECT COUNT(*)::int FROM rate_plans rp
        WHERE rp.room_id = r.id AND rp.is_active AND rp.archived_at IS NULL) AS active_rates
     FROM rooms r
     JOIN properties p ON p.id = r.property_id
     WHERE p.owner_user_id = $1
       AND p.id = $2
       AND r.archived_at IS NULL
     ORDER BY r.sort_order, r.name`,
    [property.id],
  );

  return {
    property,
    rooms: rows.map((r) => {
      const beds = normaliseBeds(r.bed_config);
      return {
        id: r.id,
        name: r.name,
        sizeM2: num(r.size_sqm),
        beds,
        // Only when there are no counts: then the free-text label is still
        // what guests see.
        legacyBedLabel: Object.keys(beds).length === 0 ? r.bed_type : null,
        units: r.total_units,
        activeRates: r.active_rates,
        coverUrl: r.cover_url,
        status: statusOf(r) === "published" ? "published" : "draft",
        sortOrder: r.sort_order,
      };
    }),
  };
}

// ─────────────────────────────────────────────
// Room editor
// ─────────────────────────────────────────────

interface RoomRow {
  id: string;
  property_id: string;
  property_name: string;
  name: string;
  description: string | null;
  size_sqm: string | null;
  bed_config: unknown;
  bed_type: string | null;
  max_adults: number;
  max_children: number;
  total_units: number;
  amenity_keys: string[] | null;
  featured_amenity_keys: string[];
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
}

interface CollectionsRow {
  photos: RoomPhotoRecord[] | null;
  rates: RateRow[] | null;
  legacy_amenities: string[] | null;
}

interface RateRow {
  id: string;
  room_id: string;
  name: string;
  description: string | null;
  includes_breakfast: boolean;
  includes_lunch: boolean;
  includes_dinner: boolean;
  extras: string[] | null;
  other_inclusion: string | null;
  min_advance_booking: number | null;
  max_advance_booking: number | null;
  cancellation_policy: string | null;
  is_active: boolean;
  priced: boolean;
  sort_order: number;
}

export function toRateRecord(r: RateRow): RatePlanRecord {
  return {
    id: r.id,
    roomId: r.room_id,
    name: r.name,
    description: r.description,
    breakfast: r.includes_breakfast,
    lunch: r.includes_lunch,
    dinner: r.includes_dinner,
    extras: (r.extras ?? []).filter((k): k is RateExtraKey =>
      (RATE_EXTRA_KEYS as string[]).includes(k),
    ),
    otherInclusion: r.other_inclusion,
    minAdvanceDays: r.min_advance_booking ?? 0,
    maxAdvanceDays: r.max_advance_booking,
    cancellationText: r.cancellation_policy,
    active: r.is_active,
    priced: r.priced,
    sortOrder: r.sort_order,
  };
}

/** The columns `RateRow` needs, for every query that builds one. */
export const RATE_COLUMNS = `
  rp.id, rp.room_id, rp.name, rp.description,
  rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner,
  rp.extras, rp.other_inclusion, rp.min_advance_booking, rp.max_advance_booking,
  rp.cancellation_policy, rp.is_active, (rp.bar > 0) AS priced, rp.sort_order`;

/**
 * Two queries, for the same reason the Property editor uses two: the second
 * fans out three collections as aggregates, and joining them into the first
 * would multiply the room row by photos × rates.
 *
 * Returns null for an archived room as well as an unknown one: an archived
 * room is not editable, and saying so differently would confirm it exists.
 */
export async function loadRoomEditor(
  session: SessionLike,
  roomId: string,
  host: HostDb = getHostScopedDb(session),
): Promise<RoomEditorData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;

  const room = await host.queryOne<RoomRow>(
    `SELECT
       r.id, r.property_id, p.name AS property_name,
       r.name, r.description, r.size_sqm, r.bed_config, r.bed_type,
       r.max_adults, r.max_children, r.total_units,
       r.amenity_keys, r.featured_amenity_keys, r.sort_order,
       r.is_active, r.archived_at
     FROM rooms r
     JOIN properties p ON p.id = r.property_id
     WHERE p.owner_user_id = $1 AND r.id = $2::uuid AND r.archived_at IS NULL`,
    [roomId],
  );
  if (!room) return null;

  const collections = await host.queryOne<CollectionsRow>(
    `SELECT
       (SELECT COALESCE(json_agg(json_build_object(
          'id', i.id, 'url', i.url, 'sortOrder', i.sort_order, 'altText', i.alt_text
        ) ORDER BY i.sort_order, i.created_at), '[]'::json)
        FROM room_images i WHERE i.room_id = r.id) AS photos,
       (SELECT COALESCE(json_agg(t ORDER BY t.sort_order, t.name), '[]'::json)
        FROM (SELECT ${RATE_COLUMNS} FROM rate_plans rp
              WHERE rp.room_id = r.id AND rp.archived_at IS NULL) t) AS rates,
       (SELECT COALESCE(array_agg(a.label), ARRAY[]::text[])
        FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id
        WHERE ra.room_id = r.id) AS legacy_amenities
     FROM rooms r
     JOIN properties p ON p.id = r.property_id
     WHERE p.owner_user_id = $1 AND r.id = $2::uuid`,
    [room.id],
  );

  const configured = normaliseBeds(room.bed_config);
  const beds = Object.keys(configured).length > 0 ? configured : bedsFromLegacyLabel(room.bed_type);

  // A room never saved from this editor reads its amenities from the legacy
  // join table, so the host starts from what guests see today.
  const amenities =
    room.amenity_keys === null
      ? amenitiesFromLegacy(collections?.legacy_amenities ?? [])
      : { amenityKeys: room.amenity_keys, featuredAmenityKeys: room.featured_amenity_keys };

  return {
    property: { id: room.property_id, name: room.property_name },
    room: {
      id: room.id,
      propertyId: room.property_id,
      name: room.name,
      description: room.description,
      sizeM2: num(room.size_sqm),
      beds,
      maxAdults: room.max_adults,
      maxChildren: room.max_children,
      units: room.total_units,
      amenityKeys: amenities.amenityKeys,
      featuredAmenityKeys: amenities.featuredAmenityKeys,
      sortOrder: room.sort_order,
      status: statusOf(room),
    },
    photos: collections?.photos ?? [],
    rates: (collections?.rates ?? []).map(toRateRecord),
  };
}
