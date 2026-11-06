import { getPool } from "@openbookings/db";
import { isTestingMode } from "@openbookings/demo";
import { NextRequest, NextResponse } from "next/server";
import { loadVisibleProperty, quoteStay } from "@/lib/booking/quote";
import { parseStayInput, todayInZone } from "@/lib/booking/stay-input";

/**
 * Prices and availability for the guest's dates on the property page. The
 * page HTML is cached without dates; this is the uncached part.
 *
 * GET /api/stay-quote?property=<slug>&checkin&checkout&adults&children&rooms
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get("property")?.trim().toLowerCase();
  if (!slug) return NextResponse.json({ errors: ["property is required"] }, { status: 400 });

  const testing = isTestingMode();
  const now = new Date();
  try {
    const db = getPool();
    const property = await loadVisibleProperty(db, { slug }, testing);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    // "In the past" is judged where the stay happens.
    const stay = parseStayInput(params, todayInZone(property.timezone, now));
    if (!stay.ok) return NextResponse.json({ errors: stay.errors }, { status: 400 });

    const quote = await quoteStay(db, { propertyId: property.id, stay: stay.value, now, testing });
    if (!quote) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    return NextResponse.json(quote);
  } catch (err) {
    // Logged, not returned — see the note in ../query/route.ts.
    console.error("[stay-quote]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Prices are unavailable right now" }, { status: 500 });
  }
}
