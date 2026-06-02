import { queryOne } from "@openbookings/db";
import { NextRequest, NextResponse } from "next/server";

export interface HotelPageData {
  id: string;
  name: string;
  subtitle: string | null;
  hero_image_url: string | null;
  logo_image_url: string | null;
  gallery_images: string[];
  lat: number;
  lon: number;
}

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
      ORDER BY pi.sort_order ASC, pi.created_at ASC
      LIMIT 1
    ) AS hero_image_url,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id AND pi.group = 'logo'
      LIMIT 1
    ) AS logo_image_url,
    (
      SELECT COALESCE(json_agg(pi.url ORDER BY pi.sort_order ASC, pi.created_at ASC), '[]'::json)
      FROM (
        SELECT pi2.url, pi2.sort_order, pi2.created_at
        FROM property_images pi2
        WHERE pi2.property_id = p.id AND (pi2.group IS NULL OR pi2.group != 'logo')
        ORDER BY pi2.sort_order ASC, pi2.created_at ASC
        LIMIT 4
      ) pi
    ) AS gallery_images
  FROM properties p
  WHERE p.slug = $1
  LIMIT 1
`;

export async function GET(request: NextRequest) {
  let slug = request.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  slug = slug.toLowerCase();

  let row: HotelPageData | null;
  try {
    row = await queryOne<HotelPageData>(HERO_SQL, [slug]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  return NextResponse.json({ ...row, gallery_images: row.gallery_images ?? [] });
}
