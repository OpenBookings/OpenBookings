import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  parseHouseNumber,
  parsePdokDocs,
  pdokSearchUrl,
  normalizePostcode,
  type PdokDoc,
} from "@/app/(dashboard)/dashboard/listings/property/_lib/address-lookup";

/**
 * Dutch postcode + house number → BAG addresses, via PDOK's Locatieserver.
 *
 * Proxied rather than called from the browser: PDOK is not a vendor the
 * privacy policy lists, and through here it sees our server, not the host.
 * Signed-in hosts only, so this is not an open relay to a public API.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const postcode = normalizePostcode(url.searchParams.get("postcode") ?? "");
  const houseNumber = parseHouseNumber(url.searchParams.get("number") ?? "");
  if (!/^\d{4}[A-Z]{2}$/.test(postcode) || !houseNumber) {
    return NextResponse.json({ candidates: [] });
  }

  try {
    const res = await fetch(pdokSearchUrl(postcode, houseNumber.number), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`PDOK ${res.status}`);
    const body = (await res.json()) as { response?: { docs?: PdokDoc[] } };
    return NextResponse.json({
      candidates: parsePdokDocs(body.response?.docs ?? [], houseNumber.addition),
    });
  } catch (err) {
    console.error("PDOK lookup failed:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
