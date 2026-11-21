import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { currentPropertyFor } from "@/lib/current-property";

/**
 * The signed-in host's current hotel id. A tab compares this with the hotel it
 * rendered to notice it went stale after a switch in another tab.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const current = await currentPropertyFor(session);
  return NextResponse.json({ propertyId: current?.propertyId ?? null }, { headers: { "Cache-Control": "no-store" } });
}
