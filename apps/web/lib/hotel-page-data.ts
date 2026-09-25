import * as Sentry from "@sentry/nextjs";
import { cached, propertyPageKey } from "@openbookings/cache";
import { getDb, sql } from "@openbookings/db";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import { buildHeroQuery, type HotelPageData } from "./hotel-page-query";

/** One `amenities` row as the page groups it; the grouping itself stays in the page. */
export interface RawAmenity {
  label: string;
  icon: string;
  category: string;
  sort_order: number;
}

/**
 * Everything the listing page needs, in one cacheable value.
 *
 * The three query results are stored verbatim rather than pre-shaped. The
 * page's amenity grouping is presentational and cheap, and caching its output
 * would tie the cached shape to a rendering decision.
 */
export interface PropertyPagePayload {
  hotel: HotelPageData;
  amenities: RawAmenity[];
  rooms: DbRoom[];
}

/**
 * Freshness is an hour rather than a minute because every write that changes
 * this page purges the key (see apps/business/lib/purge-property-page.ts), so
 * the TTL is a backstop, not the invalidation mechanism.
 *
 * The physical TTL is a day: the gap above freshness is the window in which a
 * stale copy can absorb a Neon cold start instead of erroring.
 *
 * An absence is cached for a minute only. It exists to stop a crawler walking
 * invented slugs from running three queries per 404, not to remember 404s.
 */
export const PROPERTY_PAGE_TTL = {
  freshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_S) || 3600,
  maxAgeSeconds: Number(process.env.CACHE_MAX_AGE_PROPERTY_PAGE_S) || 86400,
  missFreshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_MISS_S) || 60,
};

function buildAmenitiesQuery(slug: string) {
  return sql`
  SELECT a.label, a.icon, a.category, a.sort_order
  FROM amenities a
  JOIN property_amenities pa ON pa.amenity_id = a.id
  JOIN properties p ON p.id = pa.property_id
  WHERE p.slug = ${slug} AND p.is_active
  ORDER BY a.category, a.sort_order, a.label
`;
}

function buildRoomsQuery(slug: string) {
  return sql`
  SELECT
    r.id,
    r.name,
    r.description,
    r.room_type,
    r.bed_type,
    r.size_sqm,
    r.max_adults,
    COALESCE(
      (SELECT json_agg(ri.url ORDER BY ri.sort_order ASC, ri.created_at ASC)
       FROM room_images ri WHERE ri.room_id = r.id),
      '[]'::json
    ) AS images,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', rp.id,
        'name', rp.name,
        'bar', rp.bar,
        'currency', rp.currency,
        'is_refundable', rp.is_refundable,
        'cancellation_policy', rp.cancellation_policy,
        'meal_plan', 'Breakfast included'
      ) ORDER BY rp.bar ASC)
      FROM rate_plans rp WHERE rp.room_id = r.id AND rp.is_active = true),
      '[]'::json
    ) AS rate_plans,
    COALESCE(
      (SELECT array_agg(a.label ORDER BY a.sort_order ASC, a.label ASC)
       FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id
       WHERE ra.room_id = r.id),
      ARRAY[]::text[]
    ) AS tags
  FROM rooms r
  JOIN properties p ON p.id = r.property_id
  WHERE p.slug = ${slug} AND p.is_active AND r.is_active = true
  ORDER BY r.name
`;
}

/** The three round trips this cache exists to avoid. Still one Promise.all. */
async function loadFromDb(slug: string): Promise<PropertyPagePayload | null> {
  const db = getDb();
  const [heroResult, amenitiesResult, roomsResult] = await Promise.all([
    db.execute(buildHeroQuery(slug)),
    db.execute(buildAmenitiesQuery(slug)),
    db.execute(buildRoomsQuery(slug)),
  ]);

  const hotel = (heroResult.rows[0] as unknown as HotelPageData) ?? null;
  // `null` is the caller's 404 *and* the cache's negative entry. Returning the
  // amenities and rooms of a property that does not exist would be worse than
  // useless — it would be cached.
  if (!hotel) return null;

  return {
    hotel,
    amenities: amenitiesResult.rows as unknown as RawAmenity[],
    rooms: roomsResult.rows as unknown as DbRoom[],
  };
}

/**
 * The listing page's data, from Redis when it can be and Postgres when it
 * cannot. Returns `null` for a slug with no active property.
 */
export function getHotelPage(slug: string): Promise<PropertyPagePayload | null> {
  return cached<PropertyPagePayload>(propertyPageKey(slug), () => loadFromDb(slug), {
    ...PROPERTY_PAGE_TTL,
    onError: (error, ctx) =>
      Sentry.captureException(error, {
        tags: { area: "cache", surface: "property-page", phase: ctx.phase },
        extra: { key: ctx.key },
      }),
  });
}
