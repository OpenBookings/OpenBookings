import { queryOne } from "@openbookings/db";
import { NextRequest, NextResponse } from "next/server";

interface HotelPage {
  id: string;
  name: string;
  subtitle: string | null;
  hero_image_url: string | null;
  logo_image_url: string | null;
  lat: number;
  lon: number;
}

export interface HotelPageData {
  id: string;
  name: string;
  subtitle: string | null;
  hero_image_url: string | null;
  logo_image_url: string | null;
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
    ) AS logo_image_url
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

  let row: HotelPage | null;
  try {
    row = await queryOne<HotelPage>(HERO_SQL, [slug]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  const data: HotelPageData = {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    lat: row.lat,
    lon: row.lon,
    hero_image_url: row.hero_image_url,
    logo_image_url: row.logo_image_url,
  };

  return NextResponse.json(data);
}
