import { NextResponse } from "next/server";
import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { buildGuestExport } from "@/lib/account/export";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** GET /api/account/export — the signed-in guest's own data, as a JSON download. */
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Sign in to download your data." }, { status: 401 });

  const limit = checkRateLimit(`account-export:${session.user.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "You've downloaded your data a few times already. Try again in an hour." }, { status: 429 });
  }

  const data = await buildGuestExport(session.user.id, query);
  const day = data.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="openbookings-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
