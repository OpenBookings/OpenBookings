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
 * The query results are stored verbatim rather than pre-shaped. The
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
 * invented slugs from running the page query per 404, not to remember 404s.
 */
export const PROPERTY_PAGE_TTL = {
  freshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_S) || 3600,
  maxAgeSeconds: Number(process.env.CACHE_MAX_AGE_PROPERTY_PAGE_S) || 86400,
  missFreshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_MISS_S) || 60,
};

/**
 * The whole page in one statement: the hero row, plus the amenities and rooms
 * as JSON aggregates correlated on its id.
 *
 * This used to be three statements in a `Promise.all`. On a pool with no idle
 * connection — which is most cache misses on a quiet site — each of the three
 * checked out its own fresh connection, and a fresh connection to Neon costs
 * 100–900ms of TLS and auth (more if the compute is waking). One statement
 * needs one connection, so a single warm one is enough to skip the handshake
 * entirely. Sentry reported the old shape as an N+1 on `pg-pool.connect`
 * (OPENBOOKINGS-GUESTS-A).
 *
 * The payload must keep the values the three queries produced, because the
 * cache stores it and the components render it as-is. Moving rows into JSON
 * changes one of them: `size_sqm` is numeric, which `pg` hands back as a
 * string ("35.0") and JSON would turn into a number (35), so it is cast to
 * text. Every other field is text, uuid, an integer, a text array or already
 * JSON, and reaches the caller unchanged.
 *
 * An inactive or unknown slug yields no hero row, and therefore no row at all.
 */
function buildPropertyPageQuery(slug: string) {
  return sql`
  WITH hero AS (${buildHeroQuery(slug)})
  SELECT
    hero.*,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'label', a.label,
        'icon', a.icon,
        'category', a.category,
        'sort_order', a.sort_order
      ) ORDER BY a.category, a.sort_order, a.label), '[]'::json)
      FROM amenities a
      JOIN property_amenities pa ON pa.amenity_id = a.id
      WHERE pa.property_id = hero.id
    ) AS page_amenities,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'id', r.id,
        'name', r.name,
        'description', r.description,
        'room_type', r.room_type,
        'bed_type', r.bed_type,
        'size_sqm', r.size_sqm::text,
        'max_adults', r.max_adults,
        'images', COALESCE(
          (SELECT json_agg(ri.url ORDER BY ri.sort_order ASC, ri.created_at ASC)
           FROM room_images ri WHERE ri.room_id = r.id),
          '[]'::json
        ),
        'rate_plans', COALESCE(
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
        ),
        'tags', COALESCE(
          (SELECT array_agg(a.label ORDER BY a.sort_order ASC, a.label ASC)
           FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id
           WHERE ra.room_id = r.id),
          ARRAY[]::text[]
        )
      ) ORDER BY r.name), '[]'::json)
      FROM rooms r
      WHERE r.property_id = hero.id AND r.is_active = true
    ) AS page_rooms
  FROM hero
`;
}

type PropertyPageRow = HotelPageData & {
  page_amenities: RawAmenity[];
  page_rooms: DbRoom[];
};

/** One round trip, so one connection; see buildPropertyPageQuery. */
async function loadFromDb(slug: string): Promise<PropertyPagePayload | null> {
  const result = await getDb().execute(buildPropertyPageQuery(slug));
  const row = (result.rows[0] as unknown as PropertyPageRow | undefined) ?? null;
  // `null` is the caller's 404 *and* the cache's negative entry. Returning the
  // amenities and rooms of a property that does not exist would be worse than
  // useless — it would be cached.
  if (!row) return null;

  const { page_amenities, page_rooms, ...hotel } = row;
  return { hotel, amenities: page_amenities, rooms: page_rooms };
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
