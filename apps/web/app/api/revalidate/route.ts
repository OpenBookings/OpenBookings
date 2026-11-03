import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { bearerAuthorized, parseRevalidatePaths } from "@/lib/revalidate-request";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Called by the business app after a host saves a listing, so the cached
 * listing page is rebuilt on its next request instead of up to five minutes
 * later. Auth: `Authorization: Bearer <REVALIDATE_SECRET>`, the same secret on
 * both apps. Body: `{ "paths": ["/p/<slug>"] }`.
 *
 * Each container keeps its own page cache, so this refreshes the container
 * that answers. Others catch up within the page's `revalidate` window.
 */
export async function POST(request: Request) {
  if (!bearerAuthorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const paths = parseRevalidatePaths(await request.json().catch(() => null));
  if (!paths) {
    return NextResponse.json({ error: "invalid paths" }, { status: 400, headers: NO_STORE });
  }

  for (const path of paths) revalidatePath(path);
  return NextResponse.json({ revalidated: paths }, { headers: NO_STORE });
}
