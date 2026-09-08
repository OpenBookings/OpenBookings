import { notFound } from "next/navigation";
import { getDb, sql } from "@openbookings/db";
import { buildHeroQuery, type HotelPageData } from "@/lib/hotel-page-query";
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

function buildAmenitiesQuery(slug: string) {
  return sql`
  SELECT a.label, a.icon, a.category, a.sort_order
  FROM amenities a
  JOIN property_amenities pa ON pa.amenity_id = a.id
  JOIN properties p ON p.id = pa.property_id
  WHERE p.slug = ${slug}
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
  WHERE p.slug = ${slug} AND r.is_active = true
  ORDER BY r.name
`;
}

export default async function HotelPage({
  params,
}: {
  params: Promise<{ hotel_slug: string }>;
}) {
  const { hotel_slug } = await params;
  const slug = hotel_slug.toLowerCase();

  const db = getDb();
  const [heroResult, amenitiesResult, roomsResult] = await Promise.all([
    db.execute(buildHeroQuery(slug)),
    db.execute(buildAmenitiesQuery(slug)),
    db.execute(buildRoomsQuery(slug)),
  ]);

  const hotel = (heroResult.rows[0] as unknown as HotelPageData) ?? null;
  const rawAmenities = amenitiesResult.rows as unknown as { label: string; icon: string; category: string; sort_order: number }[];
  const rooms = roomsResult.rows as unknown as DbRoom[];

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
