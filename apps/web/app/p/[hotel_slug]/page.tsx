import { notFound } from "next/navigation";
import { queryOne, query } from "@openbookings/db";
import type { HotelPageData } from "@/app/api/query/pr/route";
import type { DbAmenityCategory, DbRoom } from "./_components/constants";

import { NavWrapper }       from "./_components/NavWrapper";
import { ScrollSpy }        from "./_components/ScrollSpy";
import { HeroSection }      from "./_components/HeroSection";
import { GalleryBar }       from "./_components/GalleryBar";
import { OverviewSection }  from "./_components/OverviewSection";
import { RoomsSection }     from "./_components/RoomsCarousel";
import { PoliciesSection }  from "./_components/PoliciesSection";
import { LocationSection }  from "./_components/LocationSection";
import { FootnoteSection }  from "./_components/FootnoteSection";

const HERO_SQL = `
  SELECT
    p.id,
    p.name,
    p.subtitle,
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lon,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi.group = 'hero-image' THEN 0 ELSE 1 END) ASC, pi.sort_order ASC, pi.created_at ASC
      LIMIT 1
    ) AS hero_image_url,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id AND pi.group = 'logo'
      LIMIT 1
    ) AS logo_image_url,
    (
      SELECT COALESCE(json_agg(json_build_object('url', pi.url, 'alt_text', pi.alt_text) ORDER BY pi.sort_order ASC, pi.created_at ASC), '[]'::json)
      FROM (
        SELECT pi2.url, pi2.alt_text, pi2.sort_order, pi2.created_at
        FROM property_images pi2
        WHERE pi2.property_id = p.id AND (pi2.group IS NULL OR pi2.group != 'logo' AND pi2.group != 'hero-image')
        ORDER BY pi2.sort_order ASC, pi2.created_at ASC
        LIMIT 20
      ) pi
    ) AS gallery_images
  FROM properties p
  WHERE p.slug = $1
  LIMIT 1
`;

const AMENITIES_SQL = `
  SELECT a.label, a.icon, a.category, a.sort_order
  FROM amenities a
  JOIN property_amenities pa ON pa.amenity_id = a.id
  JOIN properties p ON p.id = pa.property_id
  WHERE p.slug = $1
  ORDER BY a.category, a.sort_order, a.label
`;

const ROOMS_SQL = `
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
  WHERE p.slug = $1 AND r.is_active = true
  ORDER BY r.name
`;

export default async function HotelPage({
  params,
}: {
  params: Promise<{ hotel_slug: string }>;
}) {
  const { hotel_slug } = await params;
  const slug = hotel_slug.toLowerCase();

  const [hotel, rawAmenities, rooms] = await Promise.all([
    queryOne<HotelPageData>(HERO_SQL, [slug]),
    query<{ label: string; icon: string; category: string; sort_order: number }>(AMENITIES_SQL, [slug]),
    query<DbRoom>(ROOMS_SQL, [slug]),
  ]);

  if (!hotel) notFound();

  const gallery = hotel.gallery_images ?? [];

  const amenityCategories: DbAmenityCategory[] = [];
  for (const a of rawAmenities) {
    let cat = amenityCategories.find((c) => c.label === a.category);
    if (!cat) {
      cat = { label: a.category, items: [] };
      amenityCategories.push(cat);
    }
    cat.items.push({ label: a.label, icon: a.icon });
  }

  return (
    <div className="bg-[#0a0a0a] text-white">
      <NavWrapper />
      <ScrollSpy />

      <HeroSection hotel={hotel} />

      {gallery.length > 0 && (
        <div className="py-4 bg-[#0a0a0a]">
          <GalleryBar images={gallery} />
        </div>
      )}

      <OverviewSection hotel={hotel} amenityCategories={amenityCategories} />
      <RoomsSection rooms={rooms} />
      <PoliciesSection hotel={hotel} />
      <LocationSection hotel={hotel} />
      <FootnoteSection hotel={hotel} />

      <footer className="bg-[#0a0a0a] border-t border-white/6 px-4 sm:px-8 md:px-24 py-10 max-w-7xl mx-auto flex items-center justify-between text-white/30 text-sm">
        <span>{hotel.name}</span>
        <span>© {new Date().getFullYear()} OpenBookings</span>
      </footer>
    </div>
  );
}
