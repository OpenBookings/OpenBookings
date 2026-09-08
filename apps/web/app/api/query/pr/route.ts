import { getDb } from "@openbookings/db";
import { NextRequest, NextResponse } from "next/server";
import { buildHeroQuery } from "@/lib/hotel-page-query";

// Re-exported so the page's components keep importing the type from here.
// The definition, and the query that produces it, live in @/lib/hotel-page-query.
export type { HotelPageData } from "@/lib/hotel-page-query";

import type { HotelPageData } from "@/lib/hotel-page-query";

export async function GET(request: NextRequest) {
  let slug = request.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  slug = slug.toLowerCase();

  let row: HotelPageData | null;
  try {
    const result = await getDb().execute(buildHeroQuery(slug));
    row = (result.rows[0] as unknown as HotelPageData) ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...row,
    gallery_images: row.gallery_images ?? [],
    highlights: row.highlights ?? [],
  });
}
